import { t } from "../i18n";
import type { MessageKey } from "../i18n/messages";
import type { UiLanguage } from "../i18n/languages";

export type BilimuzhiIconName =
  | "archive"
  | "arrow-down"
  | "arrow-up"
  | "batch"
  | "chevron"
  | "close"
  | "copy"
  | "download"
  | "eye"
  | "eye-off"
  | "grip"
  | "image"
  | "locate"
  | "more"
  | "pencil"
  | "pin"
  | "pin-off"
  | "plus"
  | "retry"
  | "send"
  | "session"
  | "settings"
  | "stop"
  | "sync"
  | "tag"
  | "trash";

/** 图标无障碍标题的文案 key（docs/i18n-spec.md §3 aria/title 必须翻译）。 */
const ICON_TITLE_KEYS: Readonly<Record<BilimuzhiIconName, MessageKey>> = {
  archive: "archive.title",
  "arrow-down": "icon.arrowDown",
  "arrow-up": "icon.arrowUp",
  batch: "icon.batch",
  chevron: "icon.chevron",
  close: "common.close",
  copy: "icon.copy",
  download: "icon.download",
  eye: "icon.eye",
  "eye-off": "icon.eyeOff",
  grip: "icon.grip",
  more: "icon.more",
  image: "chat.addImage",
  locate: "timeline.locateCurrent",
  pencil: "icon.pencil",
  pin: "icon.pin",
  "pin-off": "drawer.actionUnpin",
  plus: "icon.plus",
  retry: "icon.retry",
  send: "icon.send",
  session: "icon.session",
  settings: "settings.title",
  stop: "icon.stop",
  sync: "timeline.syncMode",
  tag: "icon.tag",

  trash: "common.delete",
};

/**
 * 图标语言由组合根在每次 renderSnapshot 时同步（模块级单例，
 * 避免在全部调用点透传 uiLanguage；与 preact 渲染周期兼容）。
 */
let currentIconLanguage: UiLanguage = "zh-Hans";

export function setIconLanguage(language: UiLanguage): void {
  currentIconLanguage = language;
}

export function BilimuzhiIcon({
  className,
  name,
  title,
}: {
  readonly className?: string;
  readonly name: BilimuzhiIconName;
  readonly title?: string;
}) {
  const common = {
    "aria-hidden": true,
    class: className,
    "data-icon": name,
    fill: "none",
    focusable: "false",
    height: 20,
    stroke: "currentColor",
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    strokeWidth: 1.8,
    viewBox: "0 0 24 24",
    width: 20,
  };
  const svgTitle = (
    <title>{title ?? t(currentIconLanguage, ICON_TITLE_KEYS[name])}</title>
  );

  if (name === "archive") {
    return (
      <svg {...common}>
        {svgTitle}
        <path d="M4.5 7.5h15v11a1.5 1.5 0 0 1-1.5 1.5H6a1.5 1.5 0 0 1-1.5-1.5z" />
        <path d="M3.5 4h17v3.5h-17zM9 11h6" />
      </svg>
    );
  }
  if (name === "batch") {
    return (
      <svg {...common}>
        {svgTitle}
        <path d="M4 6h10M4 12h10M4 18h10" />
        <path d="m17.5 4.8 2.7 2.7-2.7 2.7M17.5 14.8l2.7 2.7-2.7 2.7" />
      </svg>
    );
  }
  if (name === "session") {
    return (
      <svg {...common}>
        {svgTitle}
        <path d="M4 5.5h16v10H9l-5 4z" />
        <path d="M8 9h8M8 12h5" />
      </svg>
    );
  }
  if (name === "trash") {
    return (
      <svg {...common}>
        {svgTitle}
        <path d="M5 7h14M9 7V4.8h6V7M7.5 7l.7 12h7.6l.7-12M10 10.5v5M14 10.5v5" />
      </svg>
    );
  }
  if (name === "settings") {
    return (
      <svg {...common}>
        {svgTitle}
        <circle cx="12" cy="12" r="3" />
        <path d="M12.2 2h-.4a2 2 0 0 0-2 2v.2a2 2 0 0 1-1 1.7l-.4.3a2 2 0 0 1-2 0l-.2-.1a2 2 0 0 0-2.7.7l-.2.4a2 2 0 0 0 .7 2.7l.2.1a2 2 0 0 1 1 1.7v.6a2 2 0 0 1-1 1.7l-.2.1a2 2 0 0 0-.7 2.7l.2.4a2 2 0 0 0 2.7.7l.2-.1a2 2 0 0 1 2 0l.4.3a2 2 0 0 1 1 1.7v.2a2 2 0 0 0 2 2h.4a2 2 0 0 0 2-2v-.2a2 2 0 0 1 1-1.7l.4-.3a2 2 0 0 1 2 0l.2.1a2 2 0 0 0 2.7-.7l.2-.4a2 2 0 0 0-.7-2.7l-.2-.1a2 2 0 0 1-1-1.7v-.6a2 2 0 0 1 1-1.7l.2-.1a2 2 0 0 0 .7-2.7l-.2-.4a2 2 0 0 0-2.7-.7l-.2.1a2 2 0 0 1-2 0l-.4-.3a2 2 0 0 1-1-1.7V4a2 2 0 0 0-2-2Z" />
      </svg>
    );
  }
  if (name === "pencil") {
    return (
      <svg {...common}>
        {svgTitle}
        <path d="m4 20 4.2-.9L19 8.3a1.8 1.8 0 0 0 0-2.6l-.7-.7a1.8 1.8 0 0 0-2.6 0L4.9 15.8zM14.6 6.1l3.3 3.3M4.9 15.8l3.3 3.3" />
      </svg>
    );
  }
  if (name === "close") {
    return (
      <svg {...common}>
        {svgTitle}
        <path d="M6 6l12 12M18 6 6 18" />
      </svg>
    );
  }
  if (name === "pin" || name === "pin-off") {
    return (
      <svg {...common}>
        {svgTitle}
        <path d="m9 4h6l-.8 4.2L17 11v1H7v-1l2.8-2.8zM12 12v8" />
        {name === "pin-off" ? <path d="M4 4l16 16" /> : null}
      </svg>
    );
  }
  if (name === "locate") {
    return (
      <svg {...common}>
        {svgTitle}
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2.5v4M12 17.5v4M2.5 12h4M17.5 12h4" />
      </svg>
    );
  }
  if (name === "sync") {
    return (
      <svg {...common}>
        {svgTitle}
        <path d="M4.9 9A7 7 0 0 1 17 5.8L19 7.6" />
        <path d="M19.1 15A7 7 0 0 1 7 18.2L5 16.4" />
        <path d="M19 2.8v4.8h-4.8M5 21.2v-4.8h4.8" />
      </svg>
    );
  }
  if (name === "plus") {
    return (
      <svg {...common}>
        {svgTitle}
        <path d="M12 5v14M5 12h14" />
      </svg>
    );
  }
  if (name === "copy") {
    return (
      <svg {...common}>
        {svgTitle}
        <rect x="8" y="8" width="11" height="11" rx="2" />
        <path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" />
      </svg>
    );
  }
  if (name === "download") {
    return (
      <svg {...common}>
        {svgTitle}
        <path d="M12 4v10M8 10l4 4 4-4M5 19h14" />
      </svg>
    );
  }
  if (name === "retry") {
    return (
      <svg {...common}>
        {svgTitle}
        <path d="M20 7v5h-5" />
        <path d="M18.2 16a8 8 0 1 1 .9-8.4L20 12" />
      </svg>
    );
  }
  if (name === "send") {
    return (
      <svg {...common}>
        {svgTitle}
        <path d="M12 19V5M6.5 10.5 12 5l5.5 5.5" />
      </svg>
    );
  }
  if (name === "stop") {
    return (
      <svg {...common} fill="currentColor" stroke="none">
        {svgTitle}
        <rect x="7" y="7" width="10" height="10" rx="1.5" />
      </svg>
    );
  }
  if (name === "image") {
    return (
      <svg {...common}>
        {svgTitle}
        <rect x="3.5" y="5" width="17" height="14" rx="2" />
        <circle cx="9" cy="10" r="1.4" />
        <path d="m5 17 4.5-4 3 2.5 2.3-2 4.2 3.5" />
      </svg>
    );
  }
  if (name === "eye" || name === "eye-off") {
    return (
      <svg {...common}>
        {svgTitle}
        <path d="M2.8 12s3.2-5 9.2-5 9.2 5 9.2 5-3.2 5-9.2 5-9.2-5-9.2-5Z" />
        <circle cx="12" cy="12" r="2.5" />
        {name === "eye-off" ? <path d="M4 4l16 16" /> : null}
      </svg>
    );
  }
  if (name === "arrow-up" || name === "arrow-down") {
    return (
      <svg {...common}>
        {svgTitle}
        {name === "arrow-up" ? (
          <path d="m7 14 5-5 5 5" />
        ) : (
          <path d="m7 10 5 5 5-5" />
        )}
      </svg>
    );
  }
  if (name === "tag") {
    return (
      <svg {...common}>
        {svgTitle}
        <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" />
        <circle cx="7.5" cy="7.5" fill="currentColor" r="1.5" stroke="none" />
      </svg>
    );
  }
  if (name === "more") {
    return (
      <svg {...common}>
        {svgTitle}
        <circle cx="5" cy="12" r="1.6" fill="currentColor" stroke="none" />
        <circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none" />
        <circle cx="19" cy="12" r="1.6" fill="currentColor" stroke="none" />
      </svg>
    );
  }
  if (name === "grip") {
    return (
      <svg {...common}>
        {svgTitle}
        <circle cx="9" cy="7" r="1" fill="currentColor" stroke="none" />
        <circle cx="15" cy="7" r="1" fill="currentColor" stroke="none" />
        <circle cx="9" cy="12" r="1" fill="currentColor" stroke="none" />
        <circle cx="15" cy="12" r="1" fill="currentColor" stroke="none" />
        <circle cx="9" cy="17" r="1" fill="currentColor" stroke="none" />
        <circle cx="15" cy="17" r="1" fill="currentColor" stroke="none" />
      </svg>
    );
  }
  return (
    <svg {...common}>
      {svgTitle}
      <path d="m7 9.5 5 5 5-5" />
    </svg>
  );
}
