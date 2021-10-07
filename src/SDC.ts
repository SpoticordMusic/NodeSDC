import DealerClient, { MessageListener } from "./DealerClient";
import axios, { AxiosResponse } from "axios";
import TrackPlaybackContext from "./TrackPlaybackContext";
import { StateMachine, StateRef } from "./interfaces";
import EventEmitter from "events";
import { TokenManager } from "./TokenManager";
import crypto from "crypto";

export class SDC extends EventEmitter implements MessageListener {
  private dealer: DealerClient;
  private deviceId: string;
  private connectionId: string = null;
  private seq: number;
  private currentContext: TrackPlaybackContext;
  private isSendingConflict: boolean = false;
  private isSendingUpdate: boolean = false;
  private queuedRejectedStates: StateRef[] = [];
  private queueSendUpdate: DebugSource[] = [];
  private currentTrackPosition: number;
  private previousTrackPosition: number;
  private currentTrackDuration: number;
  private lastSentStateUpdatePayload: StatePayload;
  private isDeviceActive: boolean = false;

  public get registered() {
    return !!this.connectionId;
  }

  public constructor(private readonly token: TokenManager, deviceId?: string) {
    super();

    if (deviceId) this.deviceId = deviceId;
    else this.deviceId = crypto.randomBytes(20).toString("hex");

    this.dealer = new DealerClient(token);
    this.dealer.addMessageListener(this, "hm://pusher/v1/connections/", "hm://track-playback/v1/command");
    this.dealer.on("close", () => this.emit("close"));
  }

  public async connect() {
    await this.dealer.connect();
  }

  public close() {
    this.dealer?.close();
  }

  public getContext() {
    return this.currentContext;
  }

  public getTokenManager() {
    return this.token;
  }

  public getDeviceID() {
    return this.deviceId;
  }

  public nextTrack(skipped: boolean = false) {
    const resp = this.currentContext.next(skipped ? "fwdbtn" : "unknown_reason");
    if (typeof resp === "string") throw new Error(resp);

    this.currentTrackDuration = this.currentContext.getCurrentTrack()?.metadata.duration;
    this.setAllTrackPositions(0);
    this.emit("play", {
      position: 0,
      paused: this.currentContext.isPaused(),
      track: this.currentContext.getCurrentTrack(),
    });

    this.updateState(DebugSource.BEFORE_TRACK_LOAD);
  }

  public previousTrack() {
    const resp = this.currentContext.previous();
    if (typeof resp === "string") throw new Error(resp);

    this.currentTrackDuration = this.currentContext.getCurrentTrack()?.metadata.duration;
    this.setAllTrackPositions(0);
    this.emit("play", {
      position: 0,
      paused: this.currentContext.isPaused(),
      track: this.currentContext.getCurrentTrack(),
    });

    this.updateState(DebugSource.BEFORE_TRACK_LOAD);
  }

  private performCommand(payload: any) {
    switch (CommandType.parse(payload.type)) {
      case CommandType.SetVolume:
        this.onVolumeChanged(payload.volume);
        break;

      case CommandType.LogOut:
        this.dealer.close();
        break;

      case CommandType.ReplaceState:
        this.replaceState(payload);
        break;

      case CommandType.Ping:
        this.updateState(DebugSource.PING);
        break;
    }
  }

  private onVolumeChanged(volume: number) {
    let payload = { volume };
    this.setSequenceNumber(payload);

    this.emit('volume', volume);

    const url = `https://api.spotify.com/v1/track-playback/v1/devices/${this.deviceId}/volume`;

    this.token.retrieveToken().then((token) => {
      axios.put(url, payload, {
        headers: {
          authorization: `Bearer ${token}`,
        },
      });
    });
  }

  private generateStatePayload(state_ref: StateRef, source?: string): StatePayload {
    return {
      state_ref,
      sub_state: {
        playback_speed: state_ref?.paused ? 0 : 1,
        position: this.currentTrackPosition,
        duration: this.currentTrackDuration || undefined,
      },
      previous_position: this.previousTrackPosition,
      debug_source: source,
    };
  }

  private createStateRef(machine: StateMachine, ref: StateRef): StateRef {
    if (!ref) return null;
    var r = machine.states[ref.state_index];
    if (!r) throw new Error("Invalid state reference");

    return {
      state_machine_id: machine.state_machine_id,
      state_id: r.state_id,
      paused: ref.paused,
    };
  }

  private isCurrentStateRef(new_ref: StateRef) {
    var cur_ref = this.currentContext ? this.currentContext.getStateRef() : null;

    return (
      (!cur_ref && !new_ref) ||
      (!(!cur_ref || !new_ref) &&
        cur_ref.state_machine_id === new_ref.state_machine_id &&
        cur_ref.state_id === new_ref.state_id &&
        cur_ref.paused === new_ref.paused)
    );
  }

  private setSequenceNumber(payload: any) {
    if (!payload.seq_num) payload.seq_num = ++this.seq;
    return payload;
  }

  private setSequenceNumbers(payload: StatePayload, length: number) {
    payload.seq_nums = [];
    for (let i = 0; i < length; i++) payload.seq_nums.push(++this.seq);

    return payload;
  }

  private rejectState(state?: StateRef) {
    var rejected = this.queuedRejectedStates;
    if (state) rejected.push(state);
    if (this.registered && !this.isSendingConflict && rejected.length) {
      this.isSendingConflict = true;
      var rejected_w = rejected.splice(0, 5);
      var ref = this.currentContext ? this.currentContext.getStateRef() : null;
      var payload = this.generateStatePayload(ref);
      payload.rejected_state_refs = rejected_w;
      this.setSequenceNumbers(payload, rejected_w.length);
      var onResponse = () => {
        this.isSendingConflict = false;
        this.rejectState();
      };

      const url = `https://api.spotify.com/v1/track-playback/v1/devices/${this.deviceId}/state_conflict`;

      this.token.retrieveToken().then((token) => {
        axios
          .post(url, payload, {
            headers: {
              authorization: `Bearer ${token}`,
            },
          })
          .then(this.handleStateConflictResponse.bind(this))
          .then(onResponse, onResponse);
      });
    }
  }

  private wasStatePayloadSentRecently(e: StatePayload) {
    var t = this.lastSentStateUpdatePayload;
    if (!t || !t.state_ref || !e.state_ref) return true;
    var r = e.state_ref;
    var n = t.state_ref;

    if (r.paused !== n.paused || r.state_id !== n.state_id || r.state_machine_id !== n.state_machine_id) return true;

    var i = e.sub_state;
    var o = t.sub_state;

    return (
      i.playback_speed !== o.playback_speed ||
      i.position !== o.position ||
      i.duration !== o.duration ||
      e.previous_position !== t.previous_position
    );
  }

  private handleStateUpdateResponse(ref: StateRef, response: AxiosResponse<any>) {
    if (200 !== response.status) {
      return Promise.reject(new Error(`Service responded with status ${response.status}`));
    }

    if (!response.data) {
      return Promise.reject(new Error(`Unexpected empty response body from state update request.`));
    }

    if (!this.currentContext) return Promise.resolve();

    var new_machine = response.data.state_machine;
    var new_ref = response.data.updated_state_ref;

    if (this.isCurrentStateRef(ref)) {
      this.currentContext.setStateMachine(new_machine);
      this.currentContext.setCurrentState(new_ref);

      return Promise.resolve();
    }

    return Promise.resolve();
  }

  private handleStateConflictResponse(resp: AxiosResponse<any>) {
    if (resp.status >= 200 && resp.status < 300) {
      const commands = resp.data?.commands;

      if (!commands || !commands.length) return;

      commands.forEach(this.performCommand.bind(this));
    } else {
      throw new Error(`Track-Playback service responded with ${resp.status}`);
    }
  }

  private updateConnectionId(newer: string) {
    newer = decodeURIComponent(newer);

    if (!this.connectionId || this.connectionId !== newer) {
      this.connectionId = newer;

      this.emit("ready");
    }
  }

  public onMessage(uri: string, headers: Map<string, string>, payload: Buffer) {
    if (uri.startsWith("hm://pusher/v1/connections/")) {
      this.updateConnectionId(headers.get("spotify-connection-id"));
    } else if (uri === "hm://track-playback/v1/command") {
      const p = JSON.parse(payload.toString("utf8"));

      this.performCommand(p);
    }
  }

  public async createDevice(name: string = "NodeSDC") {
    const resp = await axios.post(
      "https://api.spotify.com/v1/track-playback/v1/devices",
      {
        client_version: "harmony:4.19.0-9f444d2",
        connection_id: this.connectionId,
        device: {
          brand: "public_js-sdk",
          capabilities: {
            audio_podcasts: true,
            change_volume: true,
            disable_connect: false,
            enable_play_token: true,
            manifest_formats: ["file_ids_mp4"],
            play_token_lost_bheavior: "pause",
            supports_file_media_type: true,
            supports_logout: true,
            is_controllable: true,
            supports_transfer_command: true,
            supports_command_request: true,
            supported_types: ["audio/track"],
          },
          device_id: this.deviceId,
          device_type: "speaker",
          is_group: false,
          metadata: {},
          model: "harmony-node.spoticord-ts",
          name,
          platform_identifier: "Partner public_js-sdk harmony-node.spoticord-ts",
        },
        outro_endcontent_snooping: false,
        volume: 65535,
      },
      {
        headers: {
          authorization: `Bearer ${await this.token.retrieveToken()}`,
        },
        validateStatus: (_) => true,
      }
    );

    if (!(resp.status >= 200 && resp.status < 300)) return false;

    this.seq = resp.data.initial_seq_num;

    return true;
  }

  private updateState(source: DebugSource) {
    var state_ref, state_payl;
    if (!this.registered) return;

    state_ref = this.currentContext?.getStateRef() || null;
    state_payl = this.generateStatePayload(state_ref, source);

    if (!this.wasStatePayloadSentRecently(state_payl)) return;

    if (this.isSendingUpdate) {
      this.queueSendUpdate.push(source);
      return;
    }

    this.isSendingUpdate = true;
    this.queueSendUpdate = [];
    this.setSequenceNumber(state_payl);
    this.lastSentStateUpdatePayload = state_payl;

    var s = () => {
      this.isSendingUpdate = false;
      if (this.queueSendUpdate.length) {
        this.updateState(this.queueSendUpdate[this.queueSendUpdate.length - 1]);
      }
    };

    const url = `https://api.spotify.com/v1/track-playback/v1/devices/${this.deviceId}/state`;

    this.token.retrieveToken().then((token) => {
      axios
        .put(url, state_payl, {
          headers: {
            Authorization: `Bearer ${token}`,
          },
          validateStatus: (_) => true,
        })
        .then(this.handleStateUpdateResponse.bind(this, state_ref))
        .then(s, s);
    });
  }

  private replaceState(payload) {
    var payl_machine: StateMachine = payload.state_machine;
    var payl_ref: StateRef = payload.state_ref;
    var new_ref: StateRef = this.createStateRef(payl_machine, payl_ref);

    if (this.isCurrentStateRef(payload.prev_state_ref)) {
      if (payl_ref) {
        if (!this.isDeviceActive) {
          this.isDeviceActive = true;
          this.emit("activate");
        }

        var cur_ref = this.currentContext?.getStateRef() || null;
        if (!new_ref) throw new Error("New state reference is null");

        if (this.currentContext && cur_ref?.state_id === new_ref.state_id) {
          this.currentContext.setStateMachine(payl_machine);
          this.currentContext.setCurrentState(payl_ref);
          var stateChanged = false;
          if (this.currentContext.isPaused() !== payl_ref.paused) stateChanged = true;
          if (stateChanged) {
            if (payl_ref.paused) {
              this.currentContext.setPaused(true);

              this.requestPosition((pos) => {
                this.emit("pause");
                this.onPlayPause(true, pos);
              });
            } else {
              this.currentContext.setPaused(false);

              this.requestPosition((pos) => {
                this.emit("resume");
                this.onPlayPause(false, pos);
              });
            }
          }

          var p = parseInt(payload.seek_to, 10);
          if (this.currentContext.allowSeeking() && !isNaN(p)) {
            this.emit("seek", p);
            this.onPositionChanged(p);

            stateChanged = true;
          }

          if (!stateChanged) {
            this.requestPosition((pos) => {
              this.emit("modify_state");
              this.setAllTrackPositions(pos);
              this.updateState(DebugSource.MODIFY_CURRENT_STATE);
            });
          }
        } else {
          var context = TrackPlaybackContext.create();
          context.setStateMachine(payl_machine);
          context.startAtState(payl_ref);
          this.currentContext = context;

          var seek = payload.seek_to || 0;
          //context.setInitialPosition(seek);

          this.emit("play", { position: seek, paused: payl_ref.paused, track: context.getCurrentTrack() });
          this.onBeforeTrackLoad(seek);
        }
      } else {
        this.clearContextAndState();
      }
    } else {
      this.rejectState(new_ref);
    }
  }

  private async requestPosition(callback: (pos: number) => void) {
    let position = 0;
    this.emit("fetch-pos", callback);
  }

  private clearContextAndState() {
    this.isDeviceActive = false;
    this.currentContext = null;
    this.updateState(DebugSource.STATE_CLEAR);
    this.setAllTrackPositions(undefined);

    this.emit("stop");
  }

  private setCurrentTrackPosition(pos: number) {
    this.previousTrackPosition = this.currentTrackPosition;
    this.currentTrackPosition = pos;
  }

  private setAllTrackPositions(pos: number) {
    this.previousTrackPosition = pos;
    this.currentTrackPosition = pos;
  }

  private onBeforeTrackLoad(position: number) {
    this.currentTrackDuration = this.currentContext.getCurrentTrack()?.metadata?.duration;
    this.setCurrentTrackPosition(position);
    this.updateState(DebugSource.BEFORE_TRACK_LOAD);
  }

  private onPlayPause(paused: boolean, position?: number) {
    this.currentContext.setPaused(paused);
    if (position !== undefined && position !== null) this.setAllTrackPositions(position);
    this.updateState(paused ? DebugSource.PAUSE : DebugSource.RESUME);
  }

  private onPositionChanged(position: number) {
    this.setCurrentTrackPosition(position);
    this.updateState(DebugSource.POSITION_CHANGED);
  }
}

export enum DebugSource {
  TRACK_DATA_FINALIZED = "track_data_finalized",
  DEREGISTER = "deregister",
  REGISTER = "register",
  BEFORE_TRACK_LOAD = "before_track_load",
  CAPPED = "capped",
  ERROR = "error",
  PAUSE = "pause",
  RESUME = "resume",
  PLAYED_THRESHOLD_REACHED = "played_threshold_reached",
  POSITION_CHANGED = "position_changed",
  SPEED_CHANGED = "speed_changed",
  STARTED_PLAYING = "started_playing",
  PROGRESS = "progress",
  PING = "ping",
  MODIFY_CURRENT_STATE = "modify_current_state",
  STATE_CLEAR = "state_clear",
}

export class CommandType {
  private static readonly VALUES: CommandType[] = [];

  public static readonly SetVolume = new CommandType("set_volume");
  public static readonly LogOut = new CommandType("log_out");
  public static readonly ReplaceState = new CommandType("replace_state");
  public static readonly Ping = new CommandType("ping");

  public constructor(private readonly val: string) {
    CommandType.VALUES.push(this);
  }

  public static parse(value: string) {
    for (const e of CommandType.VALUES) {
      if (e.val === value) return e;
    }

    throw new Error(`Unknown command type for ${value}`);
  }
}

export interface Listener {
  ready(): void;

  command(endpoint: CommandType, data: any): void;
}

interface StatePayload {
  seq_num?: number;
  seq_nums?: number[];
  state_ref: StateRef;
  sub_state: {
    playback_speed: number;
    position: number;
    duration: number;
    media_type?: unknown;
    bitrate?: number;
    audio_quality?: unknown;
    format?: unknown;
  };
  previous_position: number;
  playback_stats?: unknown;
  rejected_state_refs?: unknown[];
  debug_source: string;
}
