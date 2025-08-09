/**
 * Helpers around chess.js to compute legal moves and enforce Hand & Brain rules.
 */
import { Chess } from "chess.js";
import type { Move, Square } from "chess.js";

export interface LegalTargets {
  /** Origin square in algebraic notation (e.g., "e2"). */
  from: string;
  /** Legal destination squares for the origin. */
  to: string[];
}

/**
 * Compute legal target squares for a given piece type on the current board.
 * Returns a unique list of destination squares for the specified piece type.
 */
export function legalTargetsForPiece(
  fen: string,
  piece: "K" | "Q" | "R" | "B" | "N" | "P",
): string[] {
  const chess = new Chess(fen);
  const legalMoves = chess.moves({ verbose: true }) as Move[];
  const targets = legalMoves
    .filter((m: Move) => m.piece.toUpperCase() === piece)
    .map((m: Move) => m.to);
  return Array.from(new Set(targets));
}

/**
 * Validate a move under Hand & Brain constraints and return next FEN and SAN.
 * Returns null if validation fails.
 */
export function validateAndMakeMove(
  fen: string,
  expectedPiece: "K" | "Q" | "R" | "B" | "N" | "P",
  from: Square,
  to: Square,
  promotion?: "q" | "r" | "b" | "n",
): { fen: string; san: string } | null {
  const chess = new Chess(fen);
  const pieceAtFrom = chess.get(from)?.type?.toUpperCase();
  if (pieceAtFrom !== expectedPiece) return null;
  type MoveInput = {
    from: Square;
    to: Square;
    promotion?: "q" | "r" | "b" | "n";
  };
  const move: MoveInput = { from: from as Square, to: to as Square, promotion };
  const result = chess.move(move);
  if (!result) return null;
  return { fen: chess.fen(), san: result.san };
}
