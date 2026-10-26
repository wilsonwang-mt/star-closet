// 中文（源）· 登录与注册。键名用英文小驼峰，按界面区域分组；占位符写 {name}，复数写 {n, plural, other {# 件}}。
const auth = {
  signin: {
    kicker: "Welcome back",
    title: "登录",
    submit: "登录",
    switch: "还没有账号？注册",
  },
  signup: {
    kicker: "Join the closet",
    title: "注册",
    submit: "注册并登录",
    switch: "已有账号？登录",
  },
  name: "昵称",
  email: "邮箱",
  password: "密码（至少 8 位）",
  busy: "请稍候…",
  goSignIn: "去登录",
  // better-auth 的错误码在 app/login/page.tsx 里对到这些键；未知错误按模式兜底。
  errors: {
    invalidCredentials: "邮箱或密码不正确",
    invalidEmail: "邮箱格式不正确",
    userExists: "这个邮箱已注册，直接登录",
    passwordTooShort: "密码至少 8 位",
    passwordTooLong: "密码太长了，请换一个短一点的",
    emailNotVerified: "邮箱还没有验证",
    tooManyRequests: "尝试次数太多，请稍后再试",
    botDetected: "安全校验没有通过，请刷新页面后再试",
    signupFailed: "注册失败，请稍后再试",
    signinFailed: "登录失败，请稍后再试",
  },
};

export default auth;
