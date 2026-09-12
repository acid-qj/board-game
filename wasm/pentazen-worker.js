import createPentaZenModule from "./pentazen.js";

let enginePromise;

function getEngine() {
  if (!enginePromise) {
    enginePromise = createPentaZenModule({
      print: () => {},
      printErr: (message) => console.error(message),
    });
  }
  return enginePromise;
}

self.addEventListener("message", async (event) => {
  const { id, history, timeLimit } = event.data;
  try {
    const engine = await getEngine();
    const packedMove = engine.bestMove(history, timeLimit);
    self.postMessage({
      id,
      x: packedMove % 15,
      y: Math.floor(packedMove / 15),
    });
  } catch (error) {
    self.postMessage({ id, error: error?.message || String(error) });
  }
});
