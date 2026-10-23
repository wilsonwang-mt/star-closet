"use client";

import { Component, type ReactNode } from "react";
import styles from "./AvatarViewer.module.css";

type Props = {
  children: ReactNode;
  onRetry: () => void;
  /** 失败提示与重试按钮文案（类组件不能用 useT，由 Viewer 传入当前语言的文案） */
  message: string;
  retryLabel: string;
};
type State = { error: Error | null };

// R3F 的 Canvas 会把场景里的错误（模型 404、解析失败、WebGL 上下文创建失败）抛回 DOM 树，这里接住。
export default class ViewerErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error) {
    console.warn("[AvatarViewer] 3D 形象加载失败：", error.message);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className={styles.overlay} role="alert">
        <p className={styles.message}>{this.props.message}</p>
        <button type="button" className="sc-cta sc-cta--ghost" onClick={this.props.onRetry}>
          {this.props.retryLabel}
        </button>
      </div>
    );
  }
}
