import { useEffect, useState } from "react";
import type { ProductItem, ScreenStateEvent } from "../../../shared/protocol";

export type ScreenConnectionState = "connecting" | "open" | "error";

export interface ScreenEventsApi {
  connectionState: ScreenConnectionState;
  products: ProductItem[];
  participantCount: number;
}

/**
 * Custom Hook que encapsula EventSource (Server-Sent Events) para la Pantalla (SRP).
 * Es estrictamente de solo lectura: nunca envía mensajes al servidor.
 */
export function useScreenEvents(): ScreenEventsApi {
  const [connectionState, setConnectionState] = useState<ScreenConnectionState>("connecting");
  const [products, setProducts] = useState<ProductItem[]>([]);
  const [participantCount, setParticipantCount] = useState(0);

  useEffect(() => {
    const source = new EventSource("/events");

    source.addEventListener("open", () => {
      setConnectionState("open");
    });

    source.addEventListener("error", () => {
      setConnectionState("error");
    });

    source.addEventListener("state", (event) => {
      try {
        const parsed = JSON.parse((event as MessageEvent<string>).data) as ScreenStateEvent;
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
  }, []);

  return {
    connectionState,
    products,
    participantCount,
  };
}
