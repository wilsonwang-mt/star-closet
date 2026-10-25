/** 场景出图相关的业务错误：status 为返回给浏览器的 HTTP 状态，message 为中文提示（接口边界再按界面语言换）。 */
export class SceneError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
