"use client";

// 首页标题旁的引导胶囊：取代手机首屏的筛选行（D51），点开就是全站悬浮对话（D66）。
import { useT } from "@/lib/i18n/client";
import { CHAT_OPEN_EVENT } from "./ChatDock";
import styles from "./ChatDock.module.css";

export default function ChatHint() {
  const t = useT("chat");
  return (
    <button
      type="button"
      className={styles.hint}
      onClick={() => window.dispatchEvent(new CustomEvent(CHAT_OPEN_EVENT))}
      aria-haspopup="dialog"
    >
      <svg width="12" height="12" viewBox="0 0 24 24" aria-hidden="true">
        <path
          d="M12 1.5c.5 4.6 1.6 7.4 3.2 8.9 1.6 1.5 4.3 2.2 7.3 2.6-3 .4-5.7 1.1-7.3 2.6-1.6 1.5-2.7 4.3-3.2 8.9-.5-4.6-1.6-7.4-3.2-8.9C7.2 14.1 4.5 13.4 1.5 13c3-.4 5.7-1.1 7.3-2.6C10.4 8.9 11.5 6.1 12 1.5Z"
          fill="#c9a96e"
        />
      </svg>
      <span className={styles.hintShort}>{t("hint.short")}</span>
      <span className={styles.hintLong}>{t("hint.long")}</span>
    </button>
  );
}
