"use client";

import { Chessboard } from "react-chessboard";
import type { CSSProperties, ReactElement } from "react";

export interface GameBoardProps {
  fen: string;
  orientation: "white" | "black";
  onSquareClick: (square: string) => void;
  onPieceDrop?: (sourceSquare: string, targetSquare: string) => boolean;
  highlightSquares?: string[];
  arePiecesDraggable?: boolean;
}

export function GameBoard(props: GameBoardProps): ReactElement {
  const {
    fen,
    orientation,
    onSquareClick,
    onPieceDrop,
    highlightSquares = [],
    arePiecesDraggable = false,
  } = props;

  const customSquareStyles: Record<string, CSSProperties> = {};
  for (const sq of highlightSquares) {
    customSquareStyles[sq] = {
      boxShadow: "inset 0 0 0 3px rgba(234,179,8,0.8)",
    };
  }

  return (
    <div className="w-full max-w-[560px]">
      <Chessboard
        id="hab-board"
        position={fen || "start"}
        boardOrientation={orientation}
        arePiecesDraggable={arePiecesDraggable}
        onSquareClick={onSquareClick}
        onPieceDrop={onPieceDrop}
        customSquareStyles={customSquareStyles}
      />
    </div>
  ) as unknown as ReactElement;
}
