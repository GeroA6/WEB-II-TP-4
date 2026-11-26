import { useState, type FormEvent } from "react";
import type { ErrorMessage } from "../../../shared/protocol";

interface JoinFormProps {
  disabled: boolean;
  error: ErrorMessage | null;
  onJoin: (name: string) => void;
}

export function JoinForm({ disabled, error, onJoin }: JoinFormProps) {
  const [name, setName] = useState("");

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    onJoin(name);
  }

  return (
    <section className="card join-card">
      <h2>Ingresar como participante</h2>
      <p className="muted">
        Elegí un nombre entre 2 y 20 caracteres (sin repetidos entre conectados).
      </p>
      <form onSubmit={handleSubmit} className="inline-form">
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Tu nombre (ej. Lucía)"
          maxLength={30}
          disabled={disabled}
          autoFocus
        />
        <button type="submit" disabled={disabled || name.trim().length === 0}>
          Entrar
        </button>
      </form>
      {error && (
        <p className="alert alert-error" role="alert">
          <strong>[{error.code}]</strong> {error.message}
        </p>
      )}
    </section>
  );
}
