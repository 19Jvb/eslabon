import { describe, expect, it } from "vitest";
import { fetchAll, PAGE_SIZE } from "@/lib/fetch-all";

// A fake PostgREST table: answers range(from, to) with at most `maxRows` rows and the exact count.
function table(total: number, maxRows = PAGE_SIZE) {
  const rows = Array.from({ length: total }, (_, i) => i);
  const calls: [number, number][] = [];
  const page = async (from: number, to: number) => {
    calls.push([from, to]);
    return { data: rows.slice(from, Math.min(to + 1, from + maxRows)), error: null, count: rows.length };
  };
  return { rows, calls, page };
}

describe("fetchAll", () => {
  it("con la tabla vacía hace una sola petición y devuelve []", async () => {
    const { calls, page } = table(0);
    expect(await fetchAll(page)).toEqual([]);
    expect(calls).toEqual([[0, PAGE_SIZE - 1]]);
  });

  it("trae más filas que el max_rows de 1000, sin perder ni repetir ninguna", async () => {
    const { rows, calls, page } = table(2500);
    expect(await fetchAll(page)).toEqual(rows);
    expect(calls).toEqual([
      [0, 999],
      [1000, 1999],
      [2000, 2999],
    ]);
  });

  it("con un múltiplo exacto de la página no hace una petición de más", async () => {
    const { rows, calls, page } = table(2000);
    expect(await fetchAll(page)).toEqual(rows);
    expect(calls).toHaveLength(2);
  });

  it("si el servidor corta antes (max_rows menor que la página), sigue hasta tener todas", async () => {
    const { rows, page } = table(1234, 300);
    expect(await fetchAll(page)).toEqual(rows);
  });

  it("un error en cualquier página devuelve null, nunca un resultado a medias", async () => {
    const { page } = table(2500);
    const failing = async (from: number, to: number) =>
      from === 1000 ? { data: null, error: new Error("boom"), count: null } : page(from, to);
    expect(await fetchAll(failing)).toBeNull();
  });

  it("sin count (no se pidió count: 'exact') devuelve null: no se puede saber si faltan filas", async () => {
    expect(await fetchAll(async () => ({ data: [1], error: null, count: null }))).toBeNull();
  });

  it("si desaparecen filas entre páginas, termina con las que quedan", async () => {
    const page = async (from: number) => ({ data: from === 0 ? [1, 2] : [], error: null, count: 5 });
    expect(await fetchAll(page)).toEqual([1, 2]);
  });
});
