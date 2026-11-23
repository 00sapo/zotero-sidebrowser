/*
 * Reads the mock page state used by the self test. Kept apart from the test
 * logic so the test can stay readable.
 */

/**
 * @param {object} actor - The window actor for the sidebar browser.
 * @returns {Promise<object>}
 */
export async function readMockState(actor) {
  return actor.sendQuery("read-mock-state", {});
}
