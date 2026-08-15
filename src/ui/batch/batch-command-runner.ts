/**
 * 批量快速命令（删除/导出/选择任务/同步）的有界执行器：
 * - 10s 超时：挂起命令不再锁死 UI；
 * - busy 释放收敛到 finally：成功、失败、超时三条路径都必须释放；
 * - 超时/失败返回 false 并设置错误文案，调用方据此渲染。
 */

export class BatchCommandTimeoutError extends Error {
  readonly name = "BatchCommandTimeoutError" as const;
}

export interface BatchCommandRunnerHooks {
  readonly isBusy: () => boolean;
  readonly onError: (message: string | undefined) => void;
  readonly onRender: () => void;
  readonly onStatus: (message: string | undefined) => void;
  readonly setBusy: (busy: boolean) => void;
}

export interface BatchCommandRunnerOptions {
  readonly errorText: string | ((error: unknown) => string);
  /** busy 时仍强制执行（删除任务等必须可打断正在进行的准备/获取）。 */
  readonly force?: boolean;
  readonly successText?: string;
  /** 省略或 undefined 表示不设超时（prepare/start 保持等待，依赖广播进度）。 */
  readonly timeoutMs?: number;
  readonly timeoutText: string;
}

function withTimeout<T>(
  action: () => Promise<T>,
  timeoutMs: number,
  timeoutText: string,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = globalThis.setTimeout(() => {
      reject(new BatchCommandTimeoutError(timeoutText));
    }, timeoutMs);
    action().then(
      (value) => {
        globalThis.clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        globalThis.clearTimeout(timer);
        reject(error);
      },
    );
  });
}

export async function runBatchCommand(
  hooks: BatchCommandRunnerHooks,
  action: () => Promise<void>,
  options: BatchCommandRunnerOptions,
): Promise<boolean> {
  if (hooks.isBusy() && options.force !== true) return false;
  hooks.setBusy(true);
  hooks.onError(undefined);
  hooks.onStatus(undefined);
  hooks.onRender();
  try {
    if (options.timeoutMs === undefined) {
      await action();
    } else {
      await withTimeout(action, options.timeoutMs, options.timeoutText);
    }
    hooks.onStatus(options.successText);
    return true;
  } catch (error) {
    hooks.onError(
      error instanceof BatchCommandTimeoutError
        ? options.timeoutText
        : typeof options.errorText === "function"
          ? options.errorText(error)
          : options.errorText,
    );
    return false;
  } finally {
    hooks.setBusy(false);
    hooks.onRender();
  }
}
