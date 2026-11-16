# 🍧 Enclocha 2 Granizados – App de pedidos (v35)

| Ruta | Qué es |
|---|---|
| `/` | **Menú principal** (resumen del día) |
| `/tomar` | Tomar pedido: granizados (varios diferentes), cervezas, licor y demás categorías |
| `/cuentas` | Cuentas abiertas: pedidos sin pagar por persona, agregar algo más y cobrar todo junto |
| `/cierre` | Cierre de caja por jornada: conteo de billetes, gastos, transferencias, cuadre e historial |
| `/presupuesto` | Presupuesto del mes para compras y gastos: cuánto queda y desde cuándo se paga con las ventas |
| `/compras` | Compras de insumos (las pagadas con plata de la caja se descuentan solas en el cierre) |
| `/gastos` | Gastos fijos: arriendo, servicios, sueldos… y control de pagos por mes |
| `/inventario` | Inventario: stock, descuentos automáticos al vender, entradas por compras, conteo físico, daños |
| `/domicilio` | **Página pública para clientes** (sin login): pedir granizados a domicilio y seguir el pedido |
| `/ventas` | Historial de ventas (todo lo cobrado), filtros y descarga para Excel |
| `/reportes` | Ventas por día, semana, mes y año · efectivo vs transferencia · lo más vendido |
| `/pedidos` | Hoja de pedidos en tiempo real con sonido, cobros y resumen |
| `/productos` | Sabores disponibles, productos, precios, tamaños, toppings y categorías |
| `/login` | Ingreso |

## Usuarios, roles y permisos
**Roles editables (v20):** en Inicio → Roles puedes crear roles nuevos (nombre, ícono y permisos), cambiar los permisos de cualquier rol o borrarlo si nadie lo tiene. En la tabla "¿Qué puede hacer cada rol?" tocas una celda para dar o quitar un permiso al instante. Los cambios aplican de una a todos los usuarios de ese rol (menos a quien tenga permisos personalizados). El Administrador es fijo: siempre tiene todo y no se borra (solo se le cambia nombre o ícono). Los roles se guardan en la base de datos (clave `roles`) y se leen junto con los usuarios en una sola operación.
- Los usuarios están en la base de datos (contraseñas cifradas). La primera vez se crean solos con Stiv, Angel, John y Fofi
  (o lo que diga la variable `USUARIOS`); después **se administran en Inicio → 👥 Usuarios** y esa variable ya no se usa.
- Roles: 👑 Administrador (todo) · 💵 Cajero · 🧾 Vendedor · 🍧 Preparación. A cada persona se le pueden personalizar los permisos.
- La app respeta los permisos en el menú, los botones y el servidor (si no tiene permiso, el servidor lo rechaza).
- Desactivar a alguien o cambiarle la clave cierra sus sesiones abiertas. Siempre debe quedar al menos un usuario que administre usuarios.

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

### Reporte mensual: ventas vs gastos (v20)
En **Reportes → 📈 Mensual** (requiere permiso de reportes; datos de `/api/ventas?r=estadisticas&mes=AAAA-MM`):
- Ventas, gastos (compras + gastos fijos pagados + gastos del cierre), utilidad, margen, cantidad, ticket promedio, promedio por jornada y jornadas trabajadas.
- Cada número se compara con el mes anterior. Si es el mes en curso, se compara **hasta el mismo día** del mes anterior.
- Frases automáticas: comparación con el mes anterior y con el mismo mes del año pasado, proyección de cierre de mes, cuánto se llevan los gastos, mejor día de la semana, hora pico, producto estrella, mejor jornada, efectivo vs transferencia y domicilios.
- Tarjeta **🛒 Compras vs ventas**: % de las ventas que se va en compras, ventas − compras, promedio de 12 meses y tabla por mes con lo que más se compró.
- Gráfica de 12 meses de ventas vs gastos (toca un mes para verlo), tabla, promedio por día de la semana, en qué se fue la plata, lo más vendido y horas con más ventas.

## QR de transferencia
Menú → **QR de pago**: sube la imagen del QR y un texto opcional (ej. número de Nequi).
Aparece al escoger "Transferencia" al tomar el pedido, al cobrar en Cuentas, y con el botón **📲 QR**.

## Consumo de la base de datos (plan gratis Upstash: 500.000 operaciones/mes)
**Fuera de horario la app no consulta sola**: solo desde la hora de abrir (4:00 p. m.) hasta 2 h después de cerrar
(ej. sábado 4:00 p. m. – 4:00 a. m.; lunes a miércoles sin festivo, nada). Fuera de eso cada pantalla carga una vez
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

## Presupuesto del mes
- Cada mes arranca con un presupuesto (se puede dejar el mismo para todos los meses).
- Lo gastan, en orden de fecha: compras y gastos de caja anotados en el cierre.
- **Los gastos fijos NO usan el presupuesto**: siempre se pagan con las ventas del mes (aparecen en la lista, pero no descuentan el presupuesto).
- Cuando se agota, lo demás se marca como "pagado con las ventas del mes" y se muestra desde qué gasto/fecha pasó.
- Compras e Inicio muestran cuánto queda; al registrar una compra que no alcanza, avisa cuánto sale de las ventas.

## Sedes (v22)
- La sede principal es **Enclocha 2 San Pío** y conserva todo lo que ya existía (usa las mismas llaves de la base de datos).
- Se crean en **Usuarios → 🏢 Sedes** (permiso "Crear y editar sedes"). Una sede nueva arranca vacía.
- **Compartido** entre sedes: menú, precios, sabores, usuarios y roles.
- **Compartido** también (todo lo que se configura): la lista de ítems del inventario (nombres, unidades, empaques, reglas, tapas, peceras), el QR de pago y la configuración de domicilios (tarifas, barrios, mínimo, WhatsApp, modo). Solo la **ubicación del local** es de cada sede.
- **Separado** por sede: pedidos, ventas, cierre de caja, cantidades del inventario (stock, movimientos, peceras prestadas), compras, gastos fijos, presupuesto y domicilios (cada sede tiene su link `/domicilio?sede=<id>`; la principal es `/domicilio`). Si una sede no tiene QR propio usa el de San Pío.
- Usuario con sede asignada: solo trabaja en esa sede. Usuario en "Todas": escoge la sede en el menú (se guarda en la cookie `sede`).
- Reportes → Mensual muestra la comparación por sede (para quien no está fijo en una sede).
- En la base de datos, las sedes nuevas usan llaves con prefijo `s:<sede>:`.

## Límite de funciones de Vercel (plan Hobby: máximo 12)
Cada archivo dentro de `api/` (menos `api/_lib/`) cuenta como una función. La app usa **10**:
- `/api/compras?r=gastosfijos` y `/api/compras?r=presupuesto` (código en `api/_lib/gastosfijos.js` y `api/_lib/presupuesto.js`)
- `/api/ventas?r=estadisticas` (código en `api/_lib/estadisticas.js`)
- `/api/usuarios?r=roles` (roles)
Si agregas más endpoints, mételos así para no pasar de 12.
