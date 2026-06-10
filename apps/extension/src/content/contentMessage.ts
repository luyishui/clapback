import type { ExtensionMessageResponse, ExtensionMessageType, ExtensionRequestMap } from "../api/types";

export async function sendContentMessage<T extends ExtensionMessageType>(
  type: T,
  payload?: ExtensionRequestMap[T]["payload"],
): Promise<ExtensionRequestMap[T]["response"]> {
  if (typeof chrome === "undefined" || !chrome.runtime?.sendMessage) {
    throw new Error("extension_background_unavailable");
  }

  const response = await sendRuntimeMessage(chrome.runtime, { type, payload });
  if (!response) throw new Error("empty_extension_response");
  if (!response.ok) throw new Error(response.error);
  return response.data;
}

function sendRuntimeMessage<T extends ExtensionMessageType>(
  runtime: typeof chrome.runtime,
  message: { type: T; payload?: ExtensionRequestMap[T]["payload"] },
): Promise<ExtensionMessageResponse<ExtensionRequestMap[T]["response"]> | undefined> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const settle = (
      response: ExtensionMessageResponse<ExtensionRequestMap[T]["response"]> | undefined,
      error?: unknown,
    ) => {
      if (settled) return;
      settled = true;
      if (error) {
        reject(error);
      } else {
        resolve(response);
      }
    };

    try {
      const maybePromise = runtime.sendMessage(message, (callbackResponse) => {
        const lastError = runtime.lastError;
        if (lastError) {
          settle(undefined, new Error(lastError.message || "extension_background_unavailable"));
          return;
        }
        settle(callbackResponse as ExtensionMessageResponse<ExtensionRequestMap[T]["response"]> | undefined);
      }) as unknown;

      if (isPromiseLike(maybePromise)) {
        maybePromise.then(
          (promiseResponse) => settle(promiseResponse as ExtensionMessageResponse<ExtensionRequestMap[T]["response"]> | undefined),
          (error) => settle(undefined, error),
        );
      }
    } catch (error) {
      try {
        const maybePromise = runtime.sendMessage(message) as unknown;
        if (isPromiseLike(maybePromise)) {
          maybePromise.then(
            (promiseResponse) => settle(promiseResponse as ExtensionMessageResponse<ExtensionRequestMap[T]["response"]> | undefined),
            (promiseError) => settle(undefined, promiseError),
          );
          return;
        }
      } catch (promiseError) {
        settle(undefined, promiseError);
        return;
      }
      settle(undefined, error);
    }
  });
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return Boolean(value) && typeof (value as { then?: unknown }).then === "function";
}
