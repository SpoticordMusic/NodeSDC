export interface SubState {
  playback_speed: number;
  position: number;
  duration: number;
  stream_time: number;
}

export interface ReplaceStateCommand {
  prev_state_ref: unknown;
  registration_token: string;
  seek_to?: number;
  selected_alias_id: any;
  state_machine: StateMachine;
  state_ref: StateRef;
  type: string;
}

export interface StateRef {
  state_machine_id?: string;
  state_id?: string;
  active_alias?: unknown;
  paused: boolean;
  state_index?: number;
}

export interface StateMachine {
  attributes: StateMachineAttributes;
  state_machine_id: string;
  states: State[];
  tracks: Track[];
}

export interface StateMachineAttributes {
  options: StateMachineAttributesOptions;
  playback_session_id: string;
}

export interface StateMachineAttributesOptions {
  repeating_context: boolean;
  repeating_track: boolean;
  shuffling_context: boolean;
}

export interface State {
  decoy: boolean;
  paused: boolean;
  disallow_seeking?: boolean;
  duration_override: number;
  initial_playback_position?: number;
  player_cookie?: string;
  position_offset: number;
  restrictions?: unknown;
  segment_start_position?: unknown;
  segment_stop_position?: unknown;
  state_id: string;
  track: number;
  track_uid?: string;
  transitions: StateTransitions;
}

export interface StateRestrictions {
  disallow_resuming_reasons: string[];
  disallow_resuming_prev_reasons: string[];
}

export interface StateTransitions {
  advance: StateRef;
  show_next: StateRef;
  show_prev: StateRef;
  skip_next: StateRef;
  skip_prev: StateRef;
}

export interface Track {
  content_type: string;
  manifest: TrackManifest;
  metadata: TrackMetadata;
  ms_played_until_update: number;
  ms_playing_update_interval: number;
  track_type: string;
}

export interface TrackManifest {
  file_ids_mp4: TrackFile[];
  file_ids_mp4_dual: TrackFile[];
}

export interface TrackFile {
  audio_quality: string;
  bitrate: number;
  file_id: string;
  file_url: string;
  format: string;
  impression_urls: any;
  track_type: string;
}

export interface TrackMetadata {
  authors: TrackAuthor[];
  context_description: any;
  context_uri: string;
  duration: number;
  group_name: string;
  group_uri: string;
  images: TrackImage[];
  linked_from_uri: any;
  name: string;
  uri: string;
}

export interface TrackAuthor {
  name: string;
  uri: string;
}

export interface TrackImage {
  url: string;
  height: number;
  width: number;
}