// Baseline scripted scenario shared by the Node tests and the browser smoke test.
// It covers: a request before a safe point (130), a request during an in-flight face edge that also
// cancels the pending audio change (350), a request exactly on both tracks' safe points (2000),
// and a retarget (2900) followed by a request stamped exactly on the safe point where that retarget
// is already due (3000): the due edge starts first, then the new target is reached through it.
export const baseline = { script: '130:tense,350:friendly,2000:tense,2900:neutral,3000:friendly', untilMs: 4700 };
