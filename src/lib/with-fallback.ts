import { unstable_rethrow } from "next/navigation";

// A Server Action call rejects when the server answers 500 or the network is down; without this,
// useActionState rethrows and Next replaces the whole page. redirect() also rejects on success,
// so Next's own errors are rethrown untouched.
export function withFallback<Args extends unknown[], Result>(
  action: (...args: Args) => Promise<Result>,
  fallback: NoInfer<Result>,
): (...args: Args) => Promise<Result> {
  return async (...args) => {
    try {
      return await action(...args);
    } catch (error) {
      unstable_rethrow(error);
      return fallback;
    }
  };
}
