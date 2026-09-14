export class ServiceError extends Error {
  constructor(status, message, options) {
    super(message, options);
    this.name = "ServiceError";
    this.status = status;
  }
}
