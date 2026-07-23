// `sleep` used to come from rati's barrel; it's a generic utility with no framework
// meaning, so it lives with the app now (rati keeps it internal-only).
export const sleep = (ms: number): Promise<void> =>
    new Promise((resolve) => setTimeout(resolve, ms));
