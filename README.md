# 🍧 Enclocha 2 Granizados – App de pedidos (v8)

| Ruta | Qué es |
|---|---|
| `/` | **Menú principal** (resumen del día) |
| `/tomar` | Tomar pedido: granizados (varios diferentes), cervezas, licor y demás categorías |
| `/cuentas` | Cuentas abiertas: pedidos sin pagar por persona, agregar algo más y cobrar todo junto |
| `/ventas` | Historial de ventas (todo lo cobrado), filtros y descarga para Excel |
| `/reportes` | Ventas por día, semana, mes y año · efectivo vs transferencia · lo más vendido |
| `/pedidos` | Hoja de pedidos en tiempo real con sonido, cobros y resumen |
| `/productos` | Sabores disponibles, productos, precios, tamaños, toppings y categorías |
| `/login` | Ingreso |

## Usuarios
Stiv / `Stiv2026*` · Angel / `Angel2026*` · John / `John2026*` · Fofi / `Fofi2026*`

Cambiar claves: variable `USUARIOS` en Vercel → `Stiv:clave1,Angel:clave2,John:clave3,Fofi:clave4` y Redeploy.

**¿Quién puede editar productos y precios?** Por defecto todos. Para limitarlo, crea la variable
`ADMINS` con los nombres, ej: `Stiv` o `Stiv,John`, y haz Redeploy.

## Productos
- Granizados: además de 8/12/16/20 oz hay Promociones, Recargas, Jueves, Pecera y Nevera
  (Productos → Presentaciones y toppings). Arrancan en $0: ponles precio.
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

## Cuentas abiertas
- Si alguien no ha pagado y pide algo más: en **Tomar pedido** escribe su nombre → sale
  "💳 tiene cuenta abierta → Agregar a su cuenta". O desde **Cuentas abiertas → ➕ Agregar algo más**.
- Lo nuevo entra como pedido aparte (cocina lo ve y suena) pero ligado a la misma cuenta.
- Al cobrar (en Cuentas o en Pedidos) se cobran **todos** los pedidos pendientes de esa cuenta.

## Ventas y reportes
- Una **venta** es un pedido cobrado. Se registra al marcarlo pagado (y se quita si se deshace el cobro o se cancela).
- Las ventas se guardan para siempre; los pedidos completos, 120 días.
- Ventas y Reportes solo los ven los administradores (variable `ADMINS`; si no existe, todos).

## QR de transferencia
Menú → **QR de pago**: sube la imagen del QR y un texto opcional (ej. número de Nequi).
Aparece al escoger "Transferencia" al tomar el pedido, al cobrar en Cuentas, y con el botón **📲 QR**.

## Consumo de la base de datos (plan gratis Upstash: 500.000 operaciones/mes)
Las pantallas solo descargan pedidos cuando hay cambios. La hoja de Pedidos revisa cada 4 s
(≈ 260.000 operaciones/mes si está abierta 12 h diarias). Revisa el consumo en Upstash → Usage.

## Jornadas y horario
| Día | Horario |
|---|---|
| Jueves | 4 p. m. – 12 a. m. |
| Viernes | 4 p. m. – 1 a. m. |
| Sábado | 4 p. m. – 2 a. m. |
| Domingo | 4 p. m. – 12 a. m. (hasta 1 a. m. si el lunes es festivo) |
| Lunes festivo | 4 p. m. – 12 a. m. |

- Cada venta pertenece a la **jornada** en que se abrió: lo vendido entre 12:00 a. m. y 5:59 a. m. cuenta para el día anterior.
- Los festivos de Colombia se calculan solos (Ley Emiliani). El horario está en `fechas.js` → `horarioDe()`.
