import { useState } from "react";
import { JoinForm } from "../components/JoinForm";
import { ProductCard } from "../components/ProductCard";
import { ProposalForm } from "../components/ProposalForm";
import { useParticipantSocket } from "../hooks/useParticipantSocket";

export function ParticipantView() {
  const {
    roomCode,
    connectionState,
    self,
    participants,
    products,
    lastProposalResult,
    isProposing,
    error,
    join,
    proposeProducts,
    vote,
    unvote,
    removeProduct,
    clearError,
  } = useParticipantSocket();
  const [copied, setCopied] = useState(false);

  const isClosed = connectionState !== "open";
  const screenHref = `/pantalla?room=${encodeURIComponent(roomCode)}`;

  function handleCopyInvite() {
    const inviteUrl = `${window.location.origin}/?room=${encodeURIComponent(roomCode)}`;
    void navigator.clipboard?.writeText(inviteUrl);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  }

  return (
    <div className="container">
      <header className="app-header">
        <div>
          <h1>Regalo Grupal · Participante</h1>
          <p className="muted">
            Lista: <strong className="room-badge">{roomCode}</strong> · WebSocket:{" "}
            <span className={`status-pill status-${connectionState}`}>
              {connectionState === "open"
                ? "Conectado"
                : connectionState === "connecting"
                  ? "Conectando..."
                  : connectionState === "reconnecting"
                    ? "Reconectando..."
                    : "Desconectado"}
            </span>
            {self && (
              <>
                {" "}
                · Sesión: <strong>{self.name}</strong>
              </>
            )}
          </p>
        </div>
        <div className="header-actions">
          {self && (
            <button type="button" className="btn-secondary" onClick={handleCopyInvite}>
              {copied ? "¡Link copiado!" : "Copiar link de lista"}
            </button>
          )}
          <a href={screenHref} target="_blank" rel="noreferrer" className="nav-link">
            Abrir Pantalla (SSE) ↗
          </a>
        </div>
      </header>

      {!self ? (
        <JoinForm
          initialRoomCode={roomCode}
          disabled={isClosed}
          error={error}
          onJoin={join}
        />
      ) : (
        <>
          {connectionState === "reconnecting" && (
            <div className="alert alert-warning" role="status">
              Se perdió la conexión con el servidor. Reconectando automáticamente como{" "}
              <strong>{self.name}</strong>...
            </div>
          )}

          <section className="card">
            <h2>Participantes conectados ({participants.length})</h2>
            <ul className="participant-list">
              {participants.map((p) => (
                <li key={p.id} className={p.id === self.id ? "chip chip-self" : "chip"}>
                  {p.name}
                  {p.id === self.id ? " (vos)" : ""}
                </li>
              ))}
            </ul>
          </section>

          <ProposalForm
            disabled={isClosed}
            isProposing={isProposing}
            lastResult={lastProposalResult}
            onPropose={proposeProducts}
          />

          {error && (
            <div className="alert alert-error error-banner" role="alert">
              <span>
                <strong>[{error.code}]</strong> {error.message}
              </span>
              <button type="button" className="btn-link" onClick={clearError}>
                Cerrar
              </button>
            </div>
          )}

          <section className="card">
            <h2>Lista de propuestas ({products.length})</h2>
            {products.length === 0 ? (
              <p className="muted">Todavía no hay productos propuestos. ¡Proponé el primero!</p>
            ) : (
              <div className="product-list">
                {products.map((product, index) => (
                  <ProductCard
                    key={product.id}
                    product={product}
                    rank={index + 1}
                    selfId={self.id}
                    disabled={isClosed}
                    onVote={vote}
                    onUnvote={unvote}
                    onRemove={removeProduct}
                  />
                ))}
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
