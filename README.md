# eMob · Costes de energía (web + Supabase)

Web para analizar las facturas de los puntos de recarga (Endesa, facturación agrupada).
Los datos se guardan en Supabase; los Excels se procesan en el navegador de quien los sube.

## Contenido
| Fichero | Qué es |
|---|---|
| `index.html`, `app.css`, `app.js` | La web |
| `procesar.js` | Lectura de Excels/ZIPs, huella anti-duplicados, preparación de filas |
| `sb.js` | Conexión con Supabase (inicio de sesión y datos) |
| `config.js` | URL y clave pública del proyecto de Supabase |
| `vendor/` | SheetJS 0.18.5 (Excel) y JSZip 3.10.1 (ZIP), incluidas para no depender de internet |
| `supabase/esquema.sql` | Tablas, reglas de acceso y funciones. Se pega en el SQL Editor |

## Actualizaciones
La web se publica con GitHub Pages desde este repositorio: cada cambio que se sube aquí
queda publicado en un par de minutos, sin descargar nada.
Si un cambio toca la base de datos, hay que volver a ejecutar `supabase/esquema.sql`
en el SQL Editor (se puede repetir sin perder datos).

## Correcciones
Sección *Correcciones*: reglas que cambian cómo cuentan algunas filas, sin tocar el dato original.
- **Poner en negativo**: consumo e importes en negativo (p. ej. estado `A`, facturas anuladoras).
- **Excluir de los cálculos**: la fila no cuenta en dashboard, puntos ni totales.
Viene creada la regla *Estado = A → negativo*. Solo los administradores pueden crear o cambiar reglas.

## Puesta en marcha
1. **Base de datos**: Supabase → SQL Editor → pegar `supabase/esquema.sql` → Run.
   Después, para ser administrador (poder vaciar datos):
   `insert into public.admins (email) values ('tu@email.com');`
2. **Usuarios**: Supabase → Authentication → Users → *Add user* → *Create new user*
   (email + contraseña, marcando *Auto Confirm User*).
   Recomendado: Authentication → Sign In / Providers → desactivar *Allow new users to sign up*,
   para que solo entre quien tú des de alta.
3. **Probar en local**: en esta carpeta, `python -m http.server 8080` y abrir http://localhost:8080
4. **Publicar** (para que entren otras personas): subir esta carpeta a un hosting estático
   (Netlify, Cloudflare Pages, GitHub Pages…). Luego en Supabase → Authentication →
   URL Configuration, poner esa dirección como *Site URL* (para los emails de invitación y
   de recuperación de contraseña).

## Duplicados
Cada fila lleva una huella de su contenido (sin contar el fichero ni la pestaña de origen).
La base de datos no admite dos filas con la misma huella, así que volver a subir un fichero,
o un `_v2` idéntico, no duplica nada.

## Seguridad
- Sin iniciar sesión no se puede leer nada.
- Cualquier usuario dado de alta puede ver y subir datos.
- Solo los emails de la tabla `admins` pueden borrar o vaciar.
