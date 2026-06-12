# @b-health/http-client

El cliente HTTP saliente de B.Health: un wrapper fino sobre axios (`APIService`) con una política única de clasificación de errores (`ServerError`), contexto de servicio listo para telemetría, throttling de llamadas en batch y un logger inyectable.

## Por qué existe

Los servicios de B.Health hacían sus llamadas HTTP salientes con copias espejadas del mismo wrapper, que divergieron con el tiempo: uno acumuló mejor manejo de errores (causa raíz encadenada, contexto del request), el otro mejor política de clasificación (mapeo único type → HTTP status, criterio de captura para monitoreo). Esta librería unifica ambas ramas en una sola fuente de verdad.

## El modelo mental

### Toda llamada saliente termina en una de dos cosas

1. **Datos** — `APIService.get/post/put/patch/delete` devuelven `response.data` tipado.
2. **Un `ServerError` clasificado** — `APIService.handleError(axiosError, "NombreDelServicio")` traduce cualquier falla a un error con política:

| Qué pasó | `type` | ¿Señal de monitoreo? |
|---|---|---|
| El servicio externo respondió 4xx | `RULE` | No — es una respuesta de negocio |
| El servicio externo respondió 5xx | `UNKNOWN` | Sí |
| No hubo respuesta (timeout, DNS, conexión rechazada) | `UNKNOWN` | Sí |

Los errores que sí son señal viajan con `serviceContext` (URL, método, status, payload de respuesta) para que la capa de telemetría del host lo eleve a tags/extra, y con el `AxiosError` original encadenado vía `cause` para no perder la causa raíz.

### `ServerError` es el vocabulario de errores de todo el servicio

```
type          → status   ¿esperado?
RULE          → 400      sí (el usuario recibió su 4xx y siguió)
SCHEMA        → 400      sí
UNAUTHORIZED  → 401      sí
NOT-FOUND     → 404      sí
INVALID-TYPE  → 500      no (violación de contrato — bug)
API           → 500      no (falla de servicio externo)
UNKNOWN       → 500      no
```

El mapeo `type → status` es la única fuente de verdad: `error.status` lo deriva, `error.isExpected()` lo deriva, y `ServerError.isSignal(error)` — la decisión de captura de monitoreo de todo el servicio — también.

## Integración

### Instalar (git-dependency por tag pineado)

```bash
npm install "github:b-health/http-client#v1.0.0"
```

axios es **peer dependency** (`>=1.6 <2`): el host es dueño de su versión de axios.

### Re-exportar desde el barrel del host

```ts
// src/Common/domain/index.ts
export * from "@b-health/http-client";
```

Los call sites no cambian: siguen importando `APIService` y `ServerError` del barrel local.

### Enchufar el logger (opcional)

La librería no loguea nada hasta que el host inyecta su logger en el bootstrap:

```ts
import { setHttpLogger } from "@b-health/http-client";
import { Logger } from "./Common/domain";

setHttpLogger(Logger); // cualquier objeto con info({ title, description })
```

Con el logger puesto, cada request emite un benchmark (`[GET] /url took 12.34ms`) por `info` — en hosts con `@b-health/telemetry`, eso es un breadcrumb.

### Vocabulario propio del host

Si el servicio necesita verbos o tipos de error propios, el patrón es **subclase, no fork**:

```ts
import { ServerError } from "@b-health/http-client";

export class AppError extends ServerError {
  // estáticos heredados: AppError.isSignal, AppError.isServerError
}
```

## Uso

```ts
import { APIService, ServerError, throttledPromises } from "@b-health/http-client";

try {
  const patient = await APIService.get<PatientI>({
    baseURL: settings.his.url,
    url: `/patients/${dni}`,
    token: settings.his.token,
    timeout: 5000,
  });
} catch (error) {
  throw APIService.handleError(error as AxiosError, "HIS");
}

// Llamadas en batch con throttle: de a 5, con 200ms entre batches
await throttledPromises((id) => notify(id), appointmentIds, 5, 200);
```

`RequestOptions` acepta además `headers`, `query` (params de URL), `body`, `httpAgent`/`httpsAgent` (keep-alive) y `maxBodyLength`.

## Ciclo de vida

- **Release**: cada merge a `master` publica solo — el bump sale de conventional commits (`feat:` → minor, `tipo!:`/`BREAKING CHANGE:` → major, resto → patch).
- **Bump en consumidores**: `npm install github:b-health/http-client#vX.Y.Z` (explícito siempre; nunca apuntar a `#master`).
- `dist/` viaja commiteado en cada tag: los consumidores instalan con `--ignore-scripts`, y el CI verifica que dist nunca quede desactualizado.
