export enum OperationResult {
  SUCCESS = "RESULT_SUCCESS",
  INVALID = "RESULT_INVALID",
  FORBIDDEN = "RESULT_FORBIDDEN",
  OUT_OF_BOUNDS = "RESULT_OUT_OF_BOUNDS",
  NO_LIST = "RESULT_NO_LIST",
  NO_TRACK = "RESULT_NO_TRACK",
  LIST_END = "RESULT_LIST_END",
  INVALID_TRACK = "RESULT_INVALID_TRACK",
  CANCELLED = "CANCELLED",
  NO_TRACK_PLAYER = "NO_TRACK_PLAYER"
}

export enum Reason {
  APPLOAD = "appload",
  BACK_BUTTON = "backbtn",
  CLICK_ROW = "clickrow",
  CLICK_SIDE = "clickside",
  END_PLAY = "endplay",
  FORWARD_BUTTON = "fwdbtn",
  LOGOUT = "logout",
  PLAY_BUTTON = "playbtn",
  POPUP = "popup",
  REMOTE = "remote",
  TRACK_DONE = "trackdone",
  TRACK_ERROR = "trackerror",
  UNKNOWN = "unknown",
  URI_OPEN = "uriopen",
  CAPPED = "capped",
  SEEK = "seek",
}