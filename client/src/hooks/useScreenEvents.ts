import { useEffect, useState } from "react";
import type { ProductItem, ScreenStateEvent } from "../../../shared/protocol";

export type ScreenConnectionState = "connecting" | "open" | "error";

export interface ScreenEventsApi {
  roomCode: string;
  connectionState: ScreenConnectionState;
  products: ProductItem[];
  participantCount: number;
}

function readRoomFromUrl(): string {
  const param = new URLSearchParams(window.location.search).get("room");
  return param && param.trim().length > 0 ? param.trim().toUpperCase() : "GENERAL";
}

/**
 * Custom Hook que encapsula EventSource (Server-Sent Events) para la Pantalla (SRP).
 * Se suscribe únicamente a la lista indicada en ?room=... (por defecto GENERAL).
 */
export function useScreenEvents(): ScreenEventsApi {
  const [roomCode, setRoomCode] = useState<string>(() => readRoomFromUrl());
  const [connectionState, setConnectionState] = useState<ScreenConnectionState>("connecting");
  const [products, setProducts] = useState<ProductItem[]>([]);
  const [participantCount, setParticipantCount] = useState(0);

  useEffect(() => {
    const source = new EventSource(`/events?room=${encodeURIComponent(roomCode)}`);

    source.addEventListener("open", () => {
      setConnectionState("open");
    });

    source.addEventListener("error", () => {
      setConnectionState("error");
    });

    source.addEventListener("state", (event) => {
      try {
        const parsed = JSON.parse((event as MessageEvent<string>).data) as ScreenStateEvent;
        setRoomCode(parsed.roomCode);
        setProducts(parsed.products);
        setParticipantCount(parsed.participantCount);
        setConnectionState("open");
      } catch {
        // Ignora frames corruptos
      }
    });

    return () => {
      source.close();
    };
  }, [roomCode]);

  return {
    roomCode,
    connectionState,
    products,
    participantCount,
  };
}
