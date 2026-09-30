"use client";

import Link from "next/link";
import type { Route } from "next";
import { useRouter } from "next/navigation";
import { type MouseEvent, type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { accountMapUrl, type MapReturnView } from "./prospect-navigation";

type ContextualMapLinkProps = {
  accountId: string;
  sourceView: MapReturnView;
  drawerId?: string | null;
  drawerTab?: string | null;
  className?: string;
  children: ReactNode;
};

export function ContextualMapLink({ accountId, sourceView, drawerId, drawerTab, className, children }: ContextualMapLinkProps) {
  const router = useRouter();
  const fallbackHref = accountMapUrl(accountId, sourceView, "", drawerId, drawerTab);
  const [href, setHref] = useState(fallbackHref);
  const anchorRef = useRef<HTMLAnchorElement>(null);

  const syncHref = useCallback(() => {
    const next = accountMapUrl(accountId, sourceView, window.location.search, drawerId, drawerTab);
    if (anchorRef.current) anchorRef.current.href = next;
    setHref(next);
    return next;
  }, [accountId, sourceView, drawerId, drawerTab]);

  useEffect(() => {
    const frame = requestAnimationFrame(syncHref);
    return () => cancelAnimationFrame(frame);
  }, [syncHref]);

  function openWithContext(event: MouseEvent<HTMLAnchorElement>) {
    const destination = syncHref();
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    router.push(destination as Route);
  }

  return <Link ref={anchorRef} className={className} href={href as Route} onClick={openWithContext} onAuxClick={syncHref} onPointerEnter={syncHref} onFocus={syncHref} onContextMenu={syncHref}>{children}</Link>;
}
