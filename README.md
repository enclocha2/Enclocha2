# 🍧 Enclocha 2 Granizados – App de pedidos (v14)

| Ruta | Qué es |
|---|---|
| `/` | **Menú principal** (resumen del día) |
| `/tomar` | Tomar pedido: granizados (varios diferentes), cervezas, licor y demás categorías |
| `/cuentas` | Cuentas abiertas: pedidos sin pagar por persona, agregar algo más y cobrar todo junto |
| `/cierre` | Cierre de caja por jornada: conteo de billetes, gastos, transferencias, cuadre e historial |
| `/compras` | Compras de insumos (las pagadas con plata de la caja se descuentan solas en el cierre) |
| `/gastos` | Gastos fijos: arriendo, servicios, sueldos… y control de pagos por mes |
| `/inventario` | Inventario: stock, descuentos automáticos al vender, entradas por compras, conteo físico, mermas |
| `/domicilio` | **Página pública para clientes** (sin login): pedir granizados a domicilio y seguir el pedido |
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
**Fuera de horario la app no consulta sola**: solo desde 1 h antes de abrir hasta 2 h después de cerrar
(ej. sábado 3:00 p. m. – 4:00 a. m.; lunes a miércoles sin festivo, nada). Fuera de eso cada pantalla carga una vez
al abrirla y muestra "🌙 Fuera de horario · 🔄 Revisar ahora". Se reactiva sola a la hora (márgenes en `fechas.js`).

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

## Cierre de caja
1. Escoge la jornada (por defecto la actual; el menú avisa si falta cerrar la de ayer).
2. Base inicial (se sugiere la base que dejó el cierre anterior) + conteo de billetes y monedas.
3. Gastos pagados con plata de la caja.
4. Transferencias que realmente llegaron (Nequi / banco).
5. La app calcula: **Debería haber = base + ventas en efectivo − gastos** y muestra si cuadra, sobra o falta.
   También el efectivo para retirar = contado − base que se deja.
- Los pedidos sin cobrar no entran al cierre (se avisa). Si algo se cobra después de cerrar, avisa que hay que volver a guardar.
- Se puede imprimir / guardar en PDF. El conteo se guarda como borrador en el navegador mientras no se guarde el cierre.

## Compras y gastos fijos
- **Compras**: cualquier usuario registra; solo administradores editan/borran. "Plata de la caja" → se descuenta en el cierre de esa jornada.
- **Gastos fijos** (solo administradores): define cada gasto (valor por pago, periodicidad, día de pago) y registra los pagos de cada mes.
- **Reportes → Mes / Año** muestra el balance: ventas − compras − gastos fijos pagados = utilidad.

## Navegación
Barra fija en todas las pantallas: abajo en el celular (Inicio, Tomar, Pedidos, Cuentas, Más) y a la izquierda en el computador.
El inicio muestra las acciones principales, los números de la jornada y los **pendientes** (cuentas abiertas, inventario bajo, cierre sin hacer, gastos vencidos, productos sin precio).

## Inventario
- "✨ Crear inventario base" arma los ítems desde los productos (cervezas/licor, vasos por tamaño, toppings, pitillos, hielo). Luego haz un **📋 Conteo físico** para poner el stock real.
- **Reglas**: qué se descuenta solo al vender (producto, tamaño de granizado, topping o cualquier granizado) y cuánto.
- Al cancelar un pedido, lo descontado vuelve. Las compras pueden sumar al inventario (campo "¿Entra al inventario?").
- **Lo agotado no se puede vender**: Tomar pedido lo bloquea (contando lo que ya está en el carrito) y el servidor también lo rechaza. La página de domicilios lo oculta.
- **Empaques**: cada ítem puede tener empaques (bolsa x100, caja x30, media caja x15...). Al comprar, registrar entradas o hacer conteo físico se escoge el empaque y se convierte a unidades.
  Sugeridos: aros/gusanos bolsa 100 · paleta sandía 50 · paleta chamoy 40 · bandera 520 · pitillos 250 · cervezas caja 30 / media 15 · Corona y Coronita caja 24 · sodas paca 24 / 48.

## Domicilios (clientes)
- Actívalos en Productos → 🛵 Domicilios: ubicación del negocio, **valor por distancia** (ej. hasta 1 km $2.000, hasta 2 km $3.000…), barrios con precio fijo (opcional), pedido mínimo, solo en horario, WhatsApp y mensaje. Ahí está el link para compartir.
- El cliente **primero comparte su ubicación**: la app calcula la distancia (en línea recta) y el valor del domicilio. Si está más lejos del último rango, sale "fuera de cobertura". Si no quiere compartirla, escoge su barrio de la lista. Sin una de las dos no puede pedir (el servidor también lo valida).
- En Pedidos sale "🗺️ Cómo llegar" (Google Maps directo a la ubicación del cliente) y la distancia.
- Los clientes solo ven `/domicilio`: arman sus granizados, ponen dirección y pagan en efectivo (con cuánto pagan) o transferencia (ven el QR).
- El pedido llega a Pedidos con sonido y la etiqueta 🛵 DOMICILIO. Flujo: Preparar → 🛵 Salió → Entregado. El cliente ve el estado en su página.
- Límite de 5 pedidos cada 30 min por conexión para evitar abusos.
