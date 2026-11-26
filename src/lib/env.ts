// The value is passed in (`requireEnv("X", process.env.X)`) because Next only inlines
// NEXT_PUBLIC_ variables into the browser bundle when they are read literally.
export function requireEnv(name: string, value: string | undefined): string {
  if (!value?.trim()) {
    throw new Error(`Falta la variable de entorno ${name}. Añádela a .env.local (ver .env.example).`);
  }
  return value;
}
