# 🍧 Granizados – Pedidos (v2)

- `/login` → ingreso de Stiv, Angel y John
- `/` → Tomar pedido: nombre del cliente, varios granizados por persona, pago (ya / después, efectivo / transferencia)
- `/pedidos` → Hoja de pedidos en tiempo real (suena con cada pedido nuevo), quién lo tomó, cobros y resumen del día

## Usuarios
| Usuario | Contraseña por defecto |
|---|---|
| Stiv  | Stiv2026*  |
| Angel | Angel2026* |
| John  | John2026*  |

**Cámbialas** sin tocar código: en Vercel → Settings → Environment Variables crea
`USUARIOS` = `Stiv:claveNueva1,Angel:claveNueva2,John:claveNueva3` y haz Redeploy.
(Así también agregas o quitas usuarios.) Al cambiarlas, las sesiones abiertas se cierran.

## Estructura
```
catalog.js          ← precios, sabores, toppings, métodos de pago
index.html          ← toma de pedidos
pedidos.html        ← hoja de pedidos con sonido
login.html          ← ingreso
sesion.js           ← utilidades de sesión del navegador
styles.css
api/pedidos.js      ← API de pedidos (requiere sesión)
api/login.js        ← iniciar / cerrar sesión
api/_lib/auth.js    ← usuarios y cookies firmadas
api/_lib/store.js   ← guardado en Upstash Redis
```

## Base de datos
Vercel → Storage → Upstash for Redis → conectar al proyecto → Redeploy.
Sin eso la app funciona pero los pedidos se pierden (lo avisa en /pedidos).
