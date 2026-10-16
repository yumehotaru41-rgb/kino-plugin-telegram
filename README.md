# Telegram públicos — plugin de Kino

Reproduce vídeos de **canales públicos de Telegram** (vista web `t.me/s/usuario`) sin cuenta ni API.

## Instalación

1. Sube `kino-plugin.json` y `plugin.js` a la raíz de un repositorio público de GitHub.
2. Añade el topic **`kino-plugin`**.
3. En Kino: **Ajustes → Plugins → Agregar** → `tu-usuario/tu-repo`.

## Configuración

En la pestaña del plugin añade los usuarios de los canales (sin `@`).

## Limitaciones

- Solo canales públicos con vista web activa.
- Las URLs del CDN de Telegram caducan (horas). Si un vídeo deja de reproducirse, vuelve a abrirlo.