import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@te-rebrand/ui/components/alert-dialog";
import { Button } from "@te-rebrand/ui/components/button";
import { useEffect, useRef, useState } from "react";

/**
 * Shown once, the first time the window is closed: Tacho does not quit, it
 * goes to the tray. The Rust side sends `tray-notice` instead of hiding the
 * window and waits for one of the three answers below.
 */
export function TrayNotice() {
  const [open, setOpen] = useState(false);
  const closeToTray = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const unlisten = listen("tray-notice", () => setOpen(true));
    return () => {
      void unlisten.then((f) => f());
    };
  }, []);

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        // Escape: the window stays open, and the next close explains again.
        if (!next) void invoke("keep_open");
      }}
    >
      {/* Enter must not quit: focus starts on "Close to tray". */}
      <AlertDialogContent initialFocus={closeToTray}>
        <AlertDialogHeader>
          <AlertDialogTitle>Tacho keeps running in the tray</AlertDialogTitle>
          <AlertDialogDescription>
            Closing this window does not stop tracking. Tacho stays in the system tray, next to the
            clock, and keeps logging your deliveries. Windows may keep its icon behind the small
            arrow there. Click the icon to open this window again; to stop Tacho, right-click it and
            choose Quit.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <Button variant="ghost" onClick={() => void invoke("quit")}>
            Quit Tacho
          </Button>
          <Button
            ref={closeToTray}
            onClick={() => {
              setOpen(false);
              void invoke("hide_to_tray");
            }}
          >
            Close to tray
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
