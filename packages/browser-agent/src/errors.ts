export class BrowserElementNotFoundError extends Error {
  constructor(message = "Browser target was not found.") {
    super(message);
    this.name = "BrowserElementNotFoundError";
  }
}

export class BrowserTimeoutError extends Error {
  constructor(message = "Browser action timed out.") {
    super(message);
    this.name = "BrowserTimeoutError";
  }
}
