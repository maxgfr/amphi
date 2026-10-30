// The Emscripten factory of eSpeak NG's phonemizer (see scripts/espeak.ts).
declare module "@diffusionstudio/piper-wasm/build/piper_phonemize.js" {
  const createPiperPhonemize: (module: Record<string, unknown>) => Promise<unknown>;
  export default createPiperPhonemize;
}
