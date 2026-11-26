import { ParticipantView } from "./views/ParticipantView";
import { ScreenView } from "./views/ScreenView";

export function App() {
  const pathname = window.location.pathname;
  if (pathname === "/pantalla" || pathname === "/pantalla/") {
    return <ScreenView />;
  }
  return <ParticipantView />;
}
