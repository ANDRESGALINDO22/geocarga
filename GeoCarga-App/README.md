# GeoCarga avance de hoy

En Windows, descomprime el ZIP completo y abre **Iniciar-Demo.cmd**. El iniciador usa Node.js y PostgreSQL instalados en el equipo. Crea una base local de demostración separada y carga tres vuelos y tres guías PDF. El primer inicio puede tardar mientras se prepara PostgreSQL. Mantén abierta la ventana del iniciador durante la exposición.

Abre http://127.0.0.1:4400 e inicia sesión con **admin@geocarga.com** y **GeoCargaDemo2026!**. Son credenciales de la demo local.

1. En **Dashboard General** verás las operaciones de ejemplo, incluidas las cargas en tránsito, en aduana y entregadas.
2. En **Reporte de Operaciones**, escribe **100001**, pulsa **Filtrar** y luego **Rastrear**. Verás el vuelo Bogotá–Lima, la etapa logística y lo que está haciendo la aeronave simulada. Usa **Buscar** para volver a consultar la posición y la fase.
3. En **Documentación y Guías**, descarga una de las tres guías precargadas. Puedes usar ese PDF para demostrar la carga de una nueva guía. Selecciona la operación, adjunta el PDF y pulsa **Subir y Vincular Documento**.
4. Pulsa Enter en la ventana del iniciador para detener la demo. Los datos quedan guardados en **.demo-local**.

Esta entrega usa PostgreSQL real y un radar local que simula los vuelos. La fase de vuelo y el estado logístico de la carga tienen orígenes distintos. La guía de ejemplo y el archivo subido se guardan en PostgreSQL. Se conserva el radar original basado en Traccar para una integración posterior. El despliegue con Terraform en AWS y el control de acceso a documentos por usuario quedan pendientes. Usa solo datos ficticios.
