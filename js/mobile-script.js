
window.initMobileDraggable = function() {
    const container = document.getElementById('draggableContainer');
    const handle = document.getElementById('mainDragHandle');

    if (container && container.parentElement !== document.body) {
        document.body.appendChild(container);
    }

    if (container && handle && !container.dataset.draggableInitialized) {
        // Використовуємо ту саму функцію makeDraggable
        makeDraggable(container, handle);
        
        if (window.L) {
            L.DomEvent.disableClickPropagation(container);
            L.DomEvent.disableScrollPropagation(container);
        }

        container.dataset.draggableInitialized = "true";
    }
};

function makeDraggable(el, handle) {
    let pos1 = 0, pos2 = 0, pos3 = 0, pos4 = 0;

    handle.onmousedown = dragMouseDown;
    handle.ontouchstart = dragMouseDown;

    function dragMouseDown(e) {
        e = e || window.event;
        const clientX = e.type === 'touchstart' ? e.touches[0].clientX : e.clientX;
        const clientY = e.type === 'touchstart' ? e.touches[0].clientY : e.clientY;
        
        pos3 = clientX;
        pos4 = clientY;
        
        document.onmouseup = closeDragElement;
        document.ontouchend = closeDragElement;
        document.onmousemove = elementDrag;
        document.ontouchmove = elementDrag;
    }

    function elementDrag(e) {
        e = e || window.event;
        const clientX = e.type === 'touchmove' ? e.touches[0].clientX : e.clientX;
        const clientY = e.type === 'touchmove' ? e.touches[0].clientY : e.clientY;

        pos1 = pos3 - clientX;
        pos2 = pos4 - clientY;
        pos3 = clientX;
        pos4 = clientY;

        // Розраховуємо нові координати
        let newTop = el.offsetTop - pos2;
        let newLeft = el.offsetLeft - pos1;

        // --- ЛОГІКА ОБМЕЖЕННЯ (BOUNDS) ---
        const padding = 10; // Мінімальний відступ від краю екрана
        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;
        const cardWidth = el.offsetWidth;
        const cardHeight = el.offsetHeight;

        // Обмеження по горизонталі (Left/Right)
        if (newLeft < padding) newLeft = padding;
        if (newLeft + cardWidth > viewportWidth - padding) {
            newLeft = viewportWidth - cardWidth - padding;
        }

        // Обмеження по вертикалі (Top/Bottom)
        if (newTop < padding) newTop = padding;
        if (newTop + cardHeight > viewportHeight - padding) {
            newTop = viewportHeight - cardHeight - padding;
        }

        // Застосовуємо безпечні координати
        el.style.top = newTop + "px";
        el.style.left = newLeft + "px";
        el.style.right = "auto"; // Обов'язково скидаємо right, щоб не конфліктував з left
        el.style.bottom = "auto";
    }

    function closeDragElement() {
        document.onmouseup = null;
        document.onmousemove = null;
        document.ontouchend = null;
        document.ontouchmove = null;
    }
}


// Активуємо функцію для вашої картки
makeDraggable(document.getElementById("draggableCard"), document.getElementById("dragHandle"));
