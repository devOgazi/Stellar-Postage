export function mockFn<T extends (...args: any[]) => any>(initialImpl?: T) {
  let currentImpl = initialImpl;
  const calls: any[][] = [];

  const fn: any = (...args: any[]) => {
    calls.push(args);
    return currentImpl ? currentImpl(...args) : undefined;
  };

  fn.calls = calls;
  fn.mockResolvedValue = (val: any) => {
    currentImpl = (() => Promise.resolve(val)) as any;
    return fn;
  };
  fn.mockResolvedValueOnce = (val: any) => {
    const prevImpl = currentImpl;
    currentImpl = (() => {
      currentImpl = prevImpl;
      return Promise.resolve(val);
    }) as any;
    return fn;
  };
  fn.mockImplementation = (fnImpl: any) => {
    currentImpl = fnImpl;
    return fn;
  };

  return fn;
}
