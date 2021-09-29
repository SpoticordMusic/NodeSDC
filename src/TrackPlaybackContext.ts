import { OperationResult, Reason } from "./enums";
import { State, StateMachine, StateRef, TrackMetadata } from "./interfaces";

export default class TrackPlaybackContext {
  private stateMachine: StateMachine;
  private currentState: State;
  private currentStateIndex: number;
  private pausedState: boolean;
  private initialPlaybackPosition: number;

  public constructor() {
    this.stateMachine = null;
    this.currentState = null;
    this.currentStateIndex = null;
    this.pausedState = false;
    this.initialPlaybackPosition = null;
  }

  public static create() {
    return new TrackPlaybackContext();
  }

  public setPaused(paused: boolean) {
    this.pausedState = paused;
  }

  public isPaused() {
    return this.currentStateIndex &&
      this.currentStateIndex < 0 &&
      this.currentState &&
      this.currentState.transitions.advance
      ? !!this.currentState.transitions.advance.paused
      : this.pausedState;
  }

  public setInitialPosition(position: number) {
    this.initialPlaybackPosition = position;
  }

  public setStateMachine(stateMachine: any) {
    this.stateMachine = stateMachine;
  }

  public startAtState(ref: StateRef) {
    const state =
      this.stateMachine && this.stateMachine.states[ref.state_index];
    if (!state) throw new Error("Invalid state reference.");

    var r = state.transitions;
    this.currentStateIndex = -1;
    this.currentState = {
      decoy: true,
      paused: !!ref.paused,
      track: -1,
      state_id: null,
      transitions: {
        advance: ref,
        show_next: r.show_next,
        show_prev: r.show_prev,
        skip_next: ref,
        skip_prev: r.skip_prev,
      },
      duration_override: state.duration_override,
      position_offset: state.position_offset,
    };
    this.pausedState = !!ref.paused;
  }

  public setCurrentState(ref: StateRef) {
    this.currentStateIndex = ref.state_index;
    this.currentState =
      this.stateMachine && this.stateMachine.states[ref.state_index];
  }

  public getStateMachine(): StateMachine {
    return this.stateMachine;
  }

  public getInternalStateRef(): StateRef {
    var paused = this.pausedState;
    var idx = this.currentStateIndex;
    if (!idx) return null;
    if (idx && idx < 0) {
      var r = this.currentState && this.currentState.transitions.advance;
      if (r) {
        idx = r.state_index;
        paused = !!r.paused;
      }
    }

    return {
      paused: paused,
      state_index: idx,
    };
  }

  public getStateRef(): StateRef {
    var state: State;
    var paused;
    var stateMachine = this.stateMachine;
    if (!stateMachine || this.currentStateIndex === null) return null;
    if (this.currentStateIndex < 0) {
      var adv_ref = this.currentState && this.currentState.transitions.advance;
      if (adv_ref) {
        state = stateMachine.states[adv_ref.state_index];
        paused = adv_ref.paused;
      }
    } else {
      state = stateMachine.states[this.currentStateIndex];
      paused = this.pausedState;
    }

    return state
      ? {
          state_machine_id: stateMachine.state_machine_id,
          state_id: state.state_id,
          paused: !!paused,
        }
      : null;
  }

  public getCurrentTrack() {
    var state: State;
    var stateMachine = this.stateMachine;
    if (!stateMachine || this.currentStateIndex === null) return null;
    if (this.currentStateIndex < 0) {
      var adv_ref = this.currentState && this.currentState.transitions.advance;
      if (adv_ref) {
        state = stateMachine.states[adv_ref.state_index];
      }
    } else {
      state = stateMachine.states[this.currentStateIndex];
    }

    return state ? stateMachine.tracks[state.track] : null;
  }

  public startAt() {
    return Promise.resolve(OperationResult.SUCCESS);
  }

  public setShuffle() {
    return Promise.resolve(OperationResult.SUCCESS);
  }

  public setRepeatMode() {
    return Promise.resolve(OperationResult.SUCCESS);
  }

  public next(reason: 'fwdbtn' | string) {
    var state = this.currentState;
    var trans_ref = null;
    if (state) {
      var transitions = state.transitions;
      switch (reason) {
        case Reason.FORWARD_BUTTON:
          if ("skip_next" in transitions) {
            trans_ref = transitions.skip_next;
          }
          break;

        default:
          if ("advance" in transitions) {
            trans_ref = transitions.advance;
          }
      }
    }

    return this.transitionTo(trans_ref, false);
  }

  public peekNext(reason: 'fwdbtn' | string) {
    var state = this.currentState;
    var trans_ref = null;
    if (state) {
      var transitions = state.transitions;
      switch (reason) {
        case Reason.FORWARD_BUTTON:
          if ("skip_next" in transitions) {
            trans_ref = transitions.skip_next;
          }
          break;

        default:
          if ("advance" in transitions) {
            trans_ref = transitions.advance;
          }
      }
    }

    return this.transitionTo(trans_ref, true);
  }

  public previous() {
    var state = this.currentState;
    var trans_ref = null;
    if (state) trans_ref = state.transitions.skip_prev;

    return this.transitionTo(trans_ref, false);
  }

  public translatePosition(off: number) {
    var state = this.currentState;
    var offset: number = state?.position_offset;

    return (offset || 0) + off;
  }

  public translateDuration(off: number) {
    var state = this.currentState;
    var offset: number = state?.duration_override;

    return (offset || 0) + off;
  }

  public handleSeek(e, t) {
    var r = this.currentState;
    return r?.duration_override && t.reason !== Reason.REMOTE
      ? t.listConstants.IGNORE
      : e;
  }

  public allowSeeking() {
    return !!this.currentState && !this.currentState.disallow_seeking;
  }

  private transitionTo(ref: StateRef, peek: boolean) {
    if (!peek) peek = false;

    var o: TrackMetadata;
    if (!ref) return 'FORBIDDEN';
    var u = this.stateMachine;
    if (!u) return 'NULL_VALUE';
    var l = u.states[ref.state_index];
    if (!l) return 'NULL_VALUE';
    var c = u.tracks[l.track];
    o = c?.metadata;

    if (!o || !o?.uri) {
      return 'NULL_VALUE';
    }

    if (!this.currentState) return 'NULL_VALUE';

    var d = this.currentState;
    var _ = d.decoy ? !!d.paused : ref.paused;

    if (!peek) {
      this.currentState = l;
      this.currentStateIndex = ref.state_index;
      this.pausedState = _;
    }

    var p = 0;

    if (!peek) {
      if (!this.initialPlaybackPosition) {
        if ("initial_playback_position" in l) {
          p = l.initial_playback_position || 0;
        }
      } else {
        p = this.initialPlaybackPosition;
        this.initialPlaybackPosition = null;
      }
    }

    return {
      position: p
    };
  }

  public getCurrentState() {
    return this.currentState;
  }
}
