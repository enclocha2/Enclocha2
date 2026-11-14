# 🍧 Granizados – Pedidos (v3)

| Ruta | Qué es |
|---|---|
| `/` | **Menú principal** (resumen del día) |
| `/tomar` | Tomar pedido: granizados (varios diferentes), cervezas, licor y demás categorías |
| `/pedidos` | Hoja de pedidos en tiempo real con sonido, cobros y resumen |
| `/productos` | Sabores disponibles, productos, precios, tamaños, toppings y categorías |
| `/login` | Ingreso |

## Usuarios
Stiv / `Stiv2026*` · Angel / `Angel2026*` · John / `John2026*`

Cambiar claves: variable `USUARIOS` en Vercel → `Stiv:clave1,Angel:clave2,John:clave3` y Redeploy.

**¿Quién puede editar productos y precios?** Por defecto todos. Para limitarlo, crea la variable
`ADMINS` con los nombres, ej: `Stiv` o `Stiv,John`, y haz Redeploy.

## Productos
- La primera vez carga los sabores, cervezas y licores de fábrica. **Cervezas y licor arrancan en $0**:
  ponles precio en Productos (salen en amarillo). Los que no tienen precio aparecen en gris y no se pueden vender.
- Todo cambio se guarda con el botón **💾 Guardar cambios**.
- Los pedidos guardan el precio del momento: si cambias un precio, los pedidos viejos no se alteran.

## Estructura
```
catalog.js          ← catálogo inicial y reglas de precio
index.html          ← menú
tomar.html          ← tomar pedido
pedidos.html        ← hoja de pedidos
productos.html      ← administración de productos
login.html, sesion.js, styles.css
api/pedidos.js      ← pedidos
api/catalogo.js     ← leer/guardar productos
api/login.js        ← sesión
api/_lib/auth.js    ← usuarios, admins
api/_lib/store.js   ← Upstash Redis
```
