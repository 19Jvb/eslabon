import { describe, expect, it } from "vitest";
import { fetchAll, PAGE_SIZE } from "@/lib/fetch-all";

type Row = { id: number };

// A fake PostgREST table queried by key: «id > after.id order by id limit PAGE_SIZE», cut at `maxRows`,
// with the exact count of the rows that match the filter (the ones still to come).
function table(total: number, maxRows = PAGE_SIZE) {
  const rows: Row[] = Array.from({ length: total }, (_, i) => ({ id: i }));
  const calls: (number | undefined)[] = [];
  const page = async (after: Row | undefined) => {
    calls.push(after?.id);
    const matching = rows.filter((row) => after === undefined || row.id > after.id);
    return { data: matching.slice(0, Math.min(PAGE_SIZE, maxRows)), error: null, count: matching.length };
  };
  return { rows, calls, page };
}

// What PostgREST really answers to a range that starts past the end (offset paging), instead of a 200 [].
const rangeNotSatisfiable = {
  data: null,
  error: { code: "PGRST103", message: "Requested range not satisfiable" },
  count: null,
  status: 416,
};

describe("fetchAll", () => {
  it("con la tabla vacía hace una sola petición, sin clave, y devuelve []", async () => {
    const { calls, page } = table(0);
    expect(await fetchAll(page)).toEqual([]);
    expect(calls).toEqual([undefined]);
  });

  it("trae más filas que el max_rows de 1000, sin perder ni repetir ninguna, pidiendo cada página tras la última fila", async () => {
    const { rows, calls, page } = table(2500);
    expect(await fetchAll(page)).toEqual(rows);
    expect(calls).toEqual([undefined, 999, 1999]);
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

  it("un error en cualquier página (el 416 PGRST103 real, por ejemplo) devuelve null, nunca un resultado a medias", async () => {
    const { page } = table(2500);
    const failing = async (after: Row | undefined) => (after?.id === 999 ? rangeNotSatisfiable : page(after));
    expect(await fetchAll(failing)).toBeNull();
  });

  it("sin count (no se pidió count: 'exact') devuelve null: no se puede saber si faltan filas", async () => {
    expect(await fetchAll(async () => ({ data: [{ id: 1 }], error: null, count: null }))).toBeNull();
  });

  // Offset paging would skip row 1000 here (it moves to position 999), or get a 416 if the table shrank past the offset.
  it("si se borra una fila ya leída antes de pedir la siguiente página, no se salta ninguna de las que quedan", async () => {
    const { rows, page } = table(1500);
    const deleting = async (after: Row | undefined) => {
      if (after) rows.splice(10, 1);
      return page(after);
    };
    const expected = [...rows];
    expect(await fetchAll(deleting)).toEqual(expected);
  });

  it("si se borran todas las que faltaban entre páginas, termina con las leídas (la página por clave sale vacía, no 416)", async () => {
    const { rows, page } = table(1500);
    const deleting = async (after: Row | undefined) => {
      if (after) rows.splice(1000);
      return page(after);
    };
    const firstPage = rows.slice(0, 1000);
    expect(await fetchAll(deleting)).toEqual(firstPage);
  });
});
