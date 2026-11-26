import type { ProductItem } from "../../../shared/protocol";

interface ProductCardProps {
  product: ProductItem;
  rank: number;
  selfId?: string;
  disabled?: boolean;
  onVote?: (productId: number) => void;
  onUnvote?: (productId: number) => void;
  onRemove?: (productId: number) => void;
  readOnly?: boolean;
}

export function ProductCard({
  product,
  rank,
  selfId,
  disabled = false,
  onVote,
  onUnvote,
  onRemove,
  readOnly = false,
}: ProductCardProps) {
  const hasVoted = selfId !== undefined && product.voterIds.includes(selfId);
  const canRemove = selfId !== undefined && product.proposedById === selfId;

  return (
    <article className="product-card">
      <div className="rank-badge">#{rank}</div>

      {product.thumbnail ? (
        <img
          src={product.thumbnail}
          alt={product.title}
          className="product-thumb"
          loading="lazy"
        />
      ) : (
        <div className="product-thumb placeholder">Sin imagen</div>
      )}

      <div className="product-info">
        <h3>
          {product.title} <span className="muted product-id">(ID #{product.id})</span>
        </h3>
        <p className="product-meta">
          <strong>${product.price.toFixed(2)}</strong> · Propuesto por{" "}
          <span>{product.proposedByName}</span>
        </p>
      </div>

      <div className="product-actions">
        <div className="vote-count" aria-label="Cantidad de votos">
          <span className="vote-number">{product.voteCount}</span>
          <span className="vote-label">{product.voteCount === 1 ? "voto" : "votos"}</span>
        </div>

        {!readOnly && (
          <div className="action-buttons">
            {hasVoted ? (
              <button
                type="button"
                className="btn-secondary"
                disabled={disabled}
                onClick={() => onUnvote?.(product.id)}
              >
                Retirar voto
              </button>
            ) : (
              <button type="button" disabled={disabled} onClick={() => onVote?.(product.id)}>
                Votar
              </button>
            )}

            {canRemove && (
              <button
                type="button"
                className="btn-danger"
                disabled={disabled}
                onClick={() => onRemove?.(product.id)}
              >
                Quitar
              </button>
            )}
          </div>
        )}
      </div>
    </article>
  );
}
