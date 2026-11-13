# 🍧 Granizados – Pedidos

- `/` → Tomar pedido (tamaño, varios sabores, 4 toppings incluidos, adicionales con cobro)
- `/pedidos` → Hoja de pedidos en tiempo real (suena con cada pedido nuevo)

## Estructura
```
catalog.js          ← precios, sabores y toppings (editar aquí)
index.html          ← toma de pedidos
pedidos.html        ← hoja de pedidos con sonido
styles.css
api/pedidos.js      ← API (GET / POST / PATCH / DELETE)
api/_lib/store.js   ← guardado en Upstash Redis
```

## Subir a Vercel
1. Sube esta carpeta a un repo de GitHub.
2. En vercel.com → **Add New → Project** → importa el repo → **Deploy** (sin configurar nada; Framework: *Other*).
3. En el proyecto → pestaña **Storage** → **Create / Connect** → **Upstash for Redis** (plan gratis) → conéctalo al proyecto.
   Esto crea solas las variables `KV_REST_API_URL` y `KV_REST_API_TOKEN` (o `UPSTASH_REDIS_REST_URL/TOKEN`; sirven cualquiera de las dos).
4. **Deployments → ⋯ → Redeploy** para que tome las variables.

Sin el paso 3 la app funciona pero los pedidos se pierden (lo avisa en /pedidos).

## Uso
- Abre `/pedidos` en el equipo de cocina/caja y toca **Activar** (el navegador exige un toque para permitir sonido). Déjala abierta.
- Revisa cada 3 s; si llega un pedido nuevo suena un "ding-dong" doble, la tarjeta parpadea y, si la pestaña está en segundo plano, cambia el título y manda notificación.
- Flujo: **Nuevo → Preparar → Entregado**. "Entregados hoy" muestra la cantidad y el total vendido del día.
- Los pedidos se guardan 30 días.

## Probar local
```
npm i -g vercel
npm install
vercel dev
```
