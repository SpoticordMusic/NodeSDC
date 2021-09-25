import { SDC, TokenManager, Track } from "./index";

const tokenMan = TokenManager.create()
  .setClientCredentials("client_id", "client_secret")
  .setRefreshToken(
    "refresh_token"
  );

const client = new SDC(tokenMan);

let trackPosition: number;
let trackStartTime: number;
let trackDuration: number;
let trackEndTimeout: NodeJS.Timeout;

setTimeout(() => {
  client.previousTrack();
}, 10000);

function startTimeout() {
  trackEndTimeout = setTimeout(() => {
    client.nextTrack();
  }, trackDuration - trackPosition);

  console.log(`Skipping to next track in ${trackDuration - trackPosition}`);
}

function stopTimeout() {
  clearTimeout(trackEndTimeout);
  trackEndTimeout = null;

  console.log(`Not skipping to next track`);
}

tokenMan.on("token", (token) => {
  console.log("New token:", token);
});

client.on("ready", async () => {
  console.debug("Ready");

  await client.createDevice("Custom Device");
});

client.on("error", () => {
  console.debug("Error");
});

client.on("play", (params: {position: number, paused: boolean, track: Track}) => {
  trackPosition = params.position;
  trackDuration = params.track.metadata.duration;

  if (!params.paused) {
    trackStartTime = Date.now();
    startTimeout();
  }
});

client.on("pause", () => {
  trackPosition += Date.now() - trackStartTime;
  stopTimeout();
});

client.on("seek", (position: number) => {
  trackPosition = position;
  trackStartTime = Date.now();

  stopTimeout();

  if (!client.getContext().isPaused()) {
    startTimeout();
  }
});

client.on('resume', () => {
  trackStartTime = Date.now();

  if (!trackEndTimeout) startTimeout();
})

client.on("fetch-pos", (setPos: (pos: number) => void) => {
  setPos(trackPosition + (Date.now() - trackStartTime));
});

client.connect();
