import { useState, type FormEvent } from "react";
import type { ErrorMessage } from "../../../shared/protocol";

interface JoinFormProps {
  initialRoomCode: string;
  disabled: boolean;
  error: ErrorMessage | null;
  onJoin: (name: string, roomCode: string) => void;
}

function generateRandomRoomCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let suffix = "";
  for (let i = 0; i < 4; i++) {
    suffix += chars[Math.floor(Math.random() * chars.length)] ?? "A";
  }
  return `GIFT-${suffix}`;
}

export function JoinForm({ initialRoomCode, disabled, error, onJoin }: JoinFormProps) {
  const [name, setName] = useState("");
  const [roomCode, setRoomCode] = useState(initialRoomCode);

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    onJoin(name, roomCode);
  }

  return (
    <section className="card join-card">
      <h2>Ingresar como participante</h2>
      <p className="muted">
        Elegí un nombre (2 a 20 caracteres, sin repetidos en la misma lista) y el código de lista.
      </p>
      <form onSubmit={handleSubmit} className="stack-form">
        <div className="inline-form">
          <input
            type="text"
            value={roomCode}
            onChange={(e) => setRoomCode(e.target.value.toUpperCase())}
            placeholder="Código de lista (ej. GENERAL o CUMPLE-ANA)"
            maxLength={20}
            disabled={disabled}
            aria-label="Código de lista"
          />
          <button
            type="button"
            className="btn-secondary"
            disabled={disabled}
            onClick={() => setRoomCode(generateRandomRoomCode())}
          >
            Generar código
          </button>
        </div>

        <div className="inline-form">
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Tu nombre (ej. Lucía)"
            maxLength={30}
            disabled={disabled}
            autoFocus
            aria-label="Nombre de participante"
          />
          <button
            type="submit"
            disabled={disabled || name.trim().length === 0 || roomCode.trim().length < 2}
          >
            Entrar
          </button>
        </div>
      </form>
      {error && (
        <p className="alert alert-error" role="alert">
          <strong>[{error.code}]</strong> {error.message}
        </p>
      )}
    </section>
  );
}
