let watchId = null;
let myLocationMarker = null;
let lastLocation = null;
let lastTimestamp = null;
let currentTrackPoints = []; // Масив для точок поточного треку
let trackLayer = null;      // Шар на карті для малювання
let shapes = JSON.parse(localStorage.getItem('savedShapes')) || [];
let activeShapeId = localStorage.getItem('activeShapeId') || null;
let markers = [];
let leafletPolygons = {}; // Об'єкт для зберігання малюнків полігонів
let isTrackingActive = false; // Прапорець для запису треку та руху камери
let sessionProgress = {};

const colorPicker = document.getElementById('colorPicker');


// Константи шарів (карта та супутник)
// 1. Звичайна карта (OpenStreetMap)
const streetLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap'
});

// 2. Супутник Google (lyrs=s — супутник, lyrs=y — гібрид з підписами)
const satelliteLayer = L.tileLayer('https://{s}.google.com/vt/lyrs=y&x={x}&y={y}&z={z}', {
    maxZoom: 20,
    subdomains: ['mt0', 'mt1', 'mt2', 'mt3'],
    attribution: '© Google Maps'
});


// Визначаємо, який шар був збережений (за замовчуванням - вулиці)
let currentLayerType = localStorage.getItem('mapLayerType') || 'streets';

// Створення карти з урахуванням збереженого шару
const map = L.map('map', {
    center: [
        localStorage.getItem('mapLat') || 50.45,
        localStorage.getItem('mapLng') || 30.52
    ],
    zoom: localStorage.getItem('mapZoom') || 13,
    layers: [currentLayerType === 'satellite' ? satelliteLayer : streetLayer]
});

// Функція перемикання (її можна додати нижче або після ініціалізації)
function toggleMapLayer() {
    const btn = document.getElementById('layerBtn');
    if (!btn) return; // Захист від помилки, якщо кнопки немає

    if (map.hasLayer(streetLayer)) {
        // Перемикаємо на супутник
        map.removeLayer(streetLayer);
        map.addLayer(satelliteLayer);
        btn.innerText = "🗺️"; // Показуємо іконку карти (щоб повернутися назад)
        localStorage.setItem('mapLayerType', 'satellite');
    } else {
        // Перемикаємо на карту
        map.removeLayer(satelliteLayer);
        map.addLayer(streetLayer);
        btn.innerText = "🛰️"; // Показуємо іконку супутника
        localStorage.setItem('mapLayerType', 'streets');
    }
}





// Ініціалізація при завантаженні
function init() {
    // document.getElementById('layerBtn').innerText = currentLayerType === 'satellite' ? "Карта" : "Супутник";
    const savedLayer = localStorage.getItem('mapLayerType') || 'streets';
    const btn = document.getElementById('layerBtn');
    if (btn) {
        // Встановлюємо правильну іконку відразу
        btn.innerText = (savedLayer === 'satellite') ? '🗺️' : '🛰️';
    }
    renderShapes();
    updateUI();
    if (activeShapeId) {
        // Переконуємося, що активне поле існує в масиві
        const activeShape = shapes.find(s => s.id === activeShapeId);
        if (activeShape) {
            renderTrack();
        }
    }
    startGlobalGPS();
}

function createNewShape() {
    const id = Date.now().toString();
    const colorPicker = document.getElementById('colorPicker');

    const newShape = {
        id: id,
        name: "Площа " + (shapes.length + 1),
        color: colorPicker ? colorPicker.value : "#3498db",
        points: [],
        isLocked: false,
        internalStrips: [],      // Для збережених смуг
        completedStrips: {},     // Для стану обробки
        lineSpacing: 10,         // Значення за замовчуванням
        startOffset: 0           // Значення за замовчуванням
    };

    shapes.push(newShape);
    activeShapeId = id;

    saveData();
    renderShapes();
    updateUI();

    // Автоматично переходимо до властивостей нової площі
    if (typeof showEditView === 'function') {
        showEditView(newShape);
    }

    // Оновлюємо статистику (буде 0 га)
    if (typeof updateCompletedStats === 'function') {
        updateCompletedStats();
    }
}


const originalRenderShapes = renderShapes; // збережемо стару, якщо треба

function openModal() {
    document.getElementById('edit-modal').style.display = 'block';
}

function closeModal() {
    document.getElementById('edit-modal').style.display = 'none';
}
function showEditView(shape) {
    document.getElementById('view-list').style.display = 'none';
    document.getElementById('view-edit').style.display = 'block';

    // Заповнюємо дані у поля
    document.getElementById('editingFieldName').innerText = shape.name || "Поле";
    document.getElementById('shapeNameInput').value = shape.name || "";
    document.getElementById('colorPicker').value = shape.color || "#2980b9";
    document.getElementById('lineSpacing').value = shape.lineSpacing !== undefined ? shape.lineSpacing : 10;
    document.getElementById('startOffset').value = shape.startOffset !== undefined ? shape.startOffset : 0;
}

function showListView() {
    activeShapeId = null;
    document.getElementById('view-list').style.display = 'block';
    document.getElementById('view-edit').style.display = 'none';
    renderShapes();
    updateUI();
}
function renderShapes() {
    const container = document.getElementById('shapes-list');
    const controls = document.getElementById('active-shape-controls');
    const nameInput = document.getElementById('shapeNameInput');

    if (!container) return; // Захист від помилок, якщо HTML ще не завантажився

    container.innerHTML = '';

    if (shapes.length > 0 && activeShapeId) {
        if (controls) controls.style.display = 'flex';
        const activeShape = shapes.find(s => s.id === activeShapeId);
        if (nameInput && activeShape) nameInput.value = activeShape.name;
    } else {
        if (controls) controls.style.display = 'none';
    }

    shapes.forEach(shape => {
        const btn = document.createElement('button');
        // btn.innerText = shape.name;
        // btn.className = 'shape-btn'; // Можна додати клас для стилів
        // btn.style.background = shape.id === activeShapeId ? '#34495e' : '#bdc3c7';
        btn.className = `shape-btn ${shape.id === activeShapeId ? 'active' : ''}`;

        // Створюємо HTML структуру: кружечок з кольором + назва
        btn.innerHTML = `
            <div class="shape-btn-content">
                <span class="color-indicator" style="background-color: ${shape.color || '#3498db'}"></span>
                <span class="shape-name">${shape.name || 'Без назви'}</span>
            </div>
        `;
        btn.onclick = () => {
            activeShapeId = shape.id;

            if (typeof calculateArea === 'function') {
                calculateArea(shape);
            }

            const colorPicker = document.getElementById('colorPicker');
            if (colorPicker) colorPicker.value = shape.color;

            saveData();
            updateUI();

            if (typeof updateCompletedStats === 'function') {
                updateCompletedStats();
            }
            showEditView(shape);
            renderTrack();
            focusOnShape();
        };
        container.appendChild(btn);
    });
}

function saveLineParams() {
    const shape = shapes.find(s => s.id === activeShapeId);
    if (shape) {
        shape.lineSpacing = parseFloat(document.getElementById('lineSpacing').value);
        shape.startOffset = parseFloat(document.getElementById('startOffset').value);

        shape.lineSpacing = parseFloat(spacingInput.value) || 10;
        shape.startOffset = parseFloat(offsetInput.value) || 0;

        console.log(`Збережено для ${shape.name}: колія ${shape.lineSpacing}м`);
        saveData();
    }
}

// Допоміжні функції для миттєвого оновлення
function updateActiveShapeName(val) {
    const shape = shapes.find(s => s.id === activeShapeId);
    if (shape) {
        shape.name = val;
        document.getElementById('editingFieldName').innerText = val;
        saveData();
    }
}

function updateActiveShapeColor(val) {
    const shape = shapes.find(s => s.id === activeShapeId);
    if (shape) {
        shape.color = val;
        saveData();
        updateUI();
    }
}

function updateUI() {
    // 1. Повне очищення карти перед перемальовуванням
    if (typeof markers !== 'undefined') {
        markers.forEach(m => map.removeLayer(m));
        markers = [];
    }

    // Очищаємо всі старі полігони та лінії
    if (typeof leafletPolygons !== 'undefined') {
        Object.values(leafletPolygons).forEach(p => map.removeLayer(p));
        leafletPolygons = {};
    }

    // Видаляємо всі допоміжні лінії (колії), якщо вони були додані як окремі шари
    map.eachLayer(layer => {
        // Якщо шар є Полігоном, Лінією або Підписом і це не основна карта
        if (layer instanceof L.Polygon || layer instanceof L.Polyline || layer instanceof L.Tooltip) {
            // Перевірка: не видаляємо тайли карти (TileLayer)
            if (!layer._url) {
                map.removeLayer(layer);
            }
        }
    });


    // 2. Перебираємо всі збережені площі (shapes)
    shapes.forEach(shape => {
        console.log("Дані об'єкта:", shape.name, "Смуг:", shape.internalStrips ? shape.internalStrips.length : 0);
        const isSelected = (shape.id === activeShapeId);

        // Створюємо масив координат [lat, lng] для Leaflet
        const leafletPath = shape.points.map(p => [p.lat, p.lng]);

        // Малюємо основний полігон
        const poly = L.polygon(leafletPath, {
            color: shape.color,
            fillColor: shape.color,
            fillOpacity: isSelected ? 0.4 : 0.2,
            weight: isSelected ? 3 : 1
        }).addTo(map);

        leafletPolygons[shape.id] = poly;

        // --- ВІДОБРАЖЕННЯ СМУГ (МІЖРЯДЬ) ---
        if (shape.internalStrips && shape.internalStrips.length > 0) {
            // Створюємо властивість для збереження стану "оброблено", якщо її немає
            if (!shape.completedStrips) shape.completedStrips = {};

            shape.internalStrips.forEach((stripData, index) => {
                const stripId = `strip-${shape.id}-${index}`; // Унікальний ID для кожної смуги
                const isCompleted = shape.completedStrips[index]; // Чи була вона клікнута раніше

                const stripLayer = L.geoJSON(turf.polygon(stripData), {
                    style: {
                        color: isCompleted ? '#27ae60' : shape.color, // Зелений, якщо оброблено
                        weight: isCompleted ? 2 : 1,
                        fillColor: isCompleted ? '#2ecc71' : shape.color,
                        fillOpacity: isCompleted ? 0.6 : 0.15,
                        dashArray: isCompleted ? '' : '5, 5'
                    },
                    onEachFeature: (feature, layer) => {
                        layer.isStrip = true;

                        const stripHa = turf.area(feature) / 10000;
                        layer.bindTooltip(`Смуга №${index + 1}: ${stripHa.toFixed(4)} га`, {
                            sticky: true,
                            direction: 'top'
                        });

                        layer.stripIndex = index;

                        layer.on('mouseover', function (e) {
                            // Замість перебору всіх шарів, просто скидаємо стилі через CSS або групу
                            // Але якщо хочете залишити скидання, робимо це акуратно:
                            map.eachLayer(l => {
                                if (l.isStrip && l.options && l.options.fillOpacity !== 0.6) {
                                    l.setStyle({ fillOpacity: 0.15, weight: 1, color: shape.color });
                                }
                            });

                            // Підсвічуємо поточну
                            this.setStyle({
                                fillOpacity: 0.4,
                                weight: 2,
                                color: '#ffffff'
                            });

                            // ПРИБИРАЄМО bringToFront() — це часто причина того, що підсвітка зникає
                        });

                        layer.on('mouseover', function (e) {
                            // 1. Скидаємо стилі інших смуг, АЛЕ враховуємо їхній статус
                            map.eachLayer(l => {
                                if (l.isStrip && l.options) {
                                    const lIndex = l.stripIndex; // збережемо індекс для перевірки
                                    const lCompleted = shape.completedStrips && shape.completedStrips[lIndex];

                                    // Якщо смуга не та, на яку ми навели, повертаємо їй її законний стиль
                                    if (l !== this) {
                                        l.setStyle({
                                            fillOpacity: lCompleted ? 0.6 : 0.15,
                                            weight: lCompleted ? 2 : 1,
                                            color: lCompleted ? '#27ae60' : shape.color
                                        });
                                    }
                                }
                            });

                            // 2. Підсвічуємо поточну смугу (робимо її яскравішою незалежно від статусу)
                            this.setStyle({
                                fillOpacity: isCompleted ? 0.8 : 0.4, // якщо оброблена — ще яскравіша, якщо ні — просто підсвічена
                                weight: 3,
                                color: '#ffffff'
                            });
                        });

                        layer.on('click', function (e) {
                            L.DomEvent.stopPropagation(e);

                            // Знімаємо фокус з елемента, щоб не з'являлася рамка браузера
                            if (this.getElement()) {
                                this.getElement().blur();
                            }

                            if (!shape.completedStrips) shape.completedStrips = {};
                            shape.completedStrips[index] = !shape.completedStrips[index];

                            // Замість повного updateUI(), що вбиває продуктивність, 
                            // просто оновимо стиль цього конкретного шару
                            this.setStyle({
                                color: shape.completedStrips[index] ? '#27ae60' : shape.color,
                                fillColor: shape.completedStrips[index] ? '#2ecc71' : shape.color,
                                fillOpacity: shape.completedStrips[index] ? 0.6 : 0.15,
                                weight: shape.completedStrips[index] ? 2 : 1
                            });
                            updateCompletedStats();
                            saveData();
                            updateCompletedStats();
                        });
                    }

                }).addTo(map);
            });
        }




        // --- БЛОК РЕДАГУВАННЯ ТОЧОК ---
        // Маркери додаємо лише якщо площа вибрана ТА НЕ заблокована
        if (isSelected && !shape.isLocked) {
            shape.points.forEach((p, index) => {
                const marker = L.marker([p.lat, p.lng], {
                    draggable: true,
                    icon: L.divIcon({
                        className: 'custom-icon',
                        html: `<div class="dot" style="--main-color: ${shape.color}"></div>`,
                        iconSize: [12, 12],
                        iconAnchor: [6, 6]
                    })
                }).addTo(map);

                // Обробка перетягування точки
                marker.on('drag', (e) => {
                    const pos = e.target.getLatLng();
                    p.lat = pos.lat;
                    p.lng = pos.lng;

                    // Оновлюємо візуальну межу полігону "на льоту"
                    const updatedPath = shape.points.map(pt => [pt.lat, pt.lng]);
                    poly.setLatLngs(updatedPath);

                    calculateArea(shape);
                });

                // Збереження після завершення руху
                marker.on('dragend', saveData);

                // Видалення точки через ПКМ
                marker.on('contextmenu', (e) => {
                    L.DomEvent.stopPropagation(e);
                    shape.points.splice(index, 1);
                    saveData();
                    updateUI();
                });

                markers.push(marker);
                if (shape.points.length >= 2) {
                    for (let i = 0; i < shape.points.length; i++) {
                        const start = shape.points[i];
                        // Беремо наступну точку, а для останньої — з'єднуємо з першою
                        const end = shape.points[(i + 1) % shape.points.length];

                        // Розрахунок відстані між двома точками (в метрах)
                        const p1 = turf.point([start.lng, start.lat]);
                        const p2 = turf.point([end.lng, end.lat]);
                        const distance = turf.distance(p1, p2, { units: 'meters' });

                        // Знаходимо середню точку для розміщення мітки
                        const midPoint = [
                            (start.lat + end.lat) / 2,
                            (start.lng + end.lng) / 2
                        ];

                        // Додаємо мітку на карту
                        L.tooltip({
                            permanent: true,
                            direction: 'center',
                            className: 'edge-label'
                        })
                            .setLatLng(midPoint)
                            .setContent(distance.toFixed(1) + " м")
                            .addTo(map);
                    }
                }
            });

            // Розрахунок площі для активного поля
            calculateArea(shape);

            // Оновлюємо стан кнопки замочка в інтерфейсі
            const lockBtn = document.getElementById('lockBtn');
            if (lockBtn) lockBtn.innerText = shape.isLocked ? "🔒" : "🔓";
        }
    });
    renderTrack(); 
}




map.on('click', (e) => {
    if (!activeShapeId) return;

    const activeShape = shapes.find(s => s.id === activeShapeId);

    // ПЕРЕВІРКА: якщо заблоковано — нічого не робимо
    if (activeShape && activeShape.isLocked) {
        console.log("Поле заблоковане для редагування");
        return;
    }

    if (activeShape) {
        activeShape.points.push({
            lng: e.latlng.lng,
            lat: e.latlng.lat
        });
        saveData();
        updateUI();
    }
});

colorPicker.oninput = (e) => {
    if (!activeShapeId) return;
    const activeShape = shapes.find(s => s.id === activeShapeId);
    if (activeShape) {
        activeShape.color = e.target.value;
        saveData();
        updateUI();
    }
};

function calculateArea(shape) {
    const areaDisplay = document.getElementById('area');

    if (shape && shape.points && shape.points.length >= 3) {
        try {
            // Перетворюємо об'єкти {lat, lng} у масиви [lng, lat] для Turf
            const coords = shape.points.map(p => [p.lng, p.lat]);
            // Замикаємо полігон (перша точка має бути останньою)
            const closed = [...coords, coords[0]];

            const polygonFeature = turf.polygon([closed]);
            const areaSqm = turf.area(polygonFeature);
            const hectares = areaSqm / 10000;

            areaDisplay.innerText = hectares.toFixed(4) + " га";
        } catch (e) {
            console.error("Помилка розрахунку:", e);
            areaDisplay.innerText = "0.0000 га";
        }
    } else {
        areaDisplay.innerText = "0.0000 га";
    }
}



function saveData() {
    try {
        localStorage.setItem('savedShapes', JSON.stringify(shapes));
        localStorage.setItem('activeShapeId', activeShapeId);

        const center = map.getCenter();
        localStorage.setItem('mapLat', center.lat);
        localStorage.setItem('mapLng', center.lng);
        localStorage.setItem('mapZoom', map.getZoom());

        console.log("Дані успішно збережено.");
    } catch (e) {
        console.error("Помилка збереження: можливо, вичерпано ліміт пам'яті (LocalStorage)", e);
        alert("Пам'ять переповнена! Спробуйте видалити старі треки.");
    }
}


function deleteShape(id) {
    // 1. Видаляємо поле з масиву
    shapes = shapes.filter(s => s.id !== id);

    // 2. Якщо видаляємо саме те поле, яке зараз відкрито
    if (activeShapeId === id) {
        activeShapeId = null;
        showListView(); // Повертаємося до списку полів
    } else {
        // Якщо видаляємо інше поле (наприклад, через ПКМ)
        renderShapes();
    }

    // 3. Зберігаємо та оновлюємо карту
    saveData();
    updateUI();
}


function clearAll() {
    if (confirm("Видалити ВСІ площі?")) {
        shapes = [];
        activeShapeId = null;
        saveData();
        renderShapes();
        updateUI();
    }
}

init();

// Зміна назви в реальному часі
document.getElementById('shapeNameInput').addEventListener('input', (e) => {
    const shape = shapes.find(s => s.id === activeShapeId);
    if (shape) {
        shape.name = e.target.value;
        saveData();
        renderShapes(); // Оновлюємо текст на кнопці в списку
    }
});

// Фокусування на вибраній площі
function focusOnShape() {
    const shape = shapes.find(s => s.id === activeShapeId);

    // Перевіряємо, чи є поле і чи має воно точки
    if (!shape || !shape.points || shape.points.length === 0) return;

    // Створюємо масив координат для Leaflet
    const latLngs = shape.points.map(p => [p.lat, p.lng]);
    const bounds = L.latLngBounds(latLngs);

    // Підганяємо камеру
    map.fitBounds(bounds, {
        padding: [30, 30], // Відступи [зверху/знизу, зліва/справа]
        maxZoom: 19,       // Оптимальний зум для супутника
        animate: true
    });
}


// Видалення активної площі
function deleteActiveShape() {
    if (!activeShapeId) return;

    // 1. Питаємо підтвердження
    if (confirm("Видалити цю площу?")) {
        // 2. Викликаємо існуючий метод видалення
        deleteShape(activeShapeId);

        // 3. Скидаємо активний ID, щоб нічого не було вибрано
        activeShapeId = null;

        // 4. ПОВЕРТАЄМОСЯ ДО СПИСКУ (вихід з налаштувань)
        showListView();

        // 5. Оновлюємо карту та статистику
        updateUI();
        if (typeof updateCompletedStats === 'function') {
            updateCompletedStats();
        }
    }
}


function toggleLock() {
    const shape = shapes.find(s => s.id === activeShapeId);
    if (shape) {
        shape.isLocked = !shape.isLocked;
        document.getElementById('lockBtn').innerText = shape.isLocked ? "🔒" : "🔓";
        saveData();
        updateUI(); // При перемальовуванні зникнуть/з'являться маркери
    }
}

function generateLines() {
    const shape = shapes.find(s => s.id === activeShapeId);
    if (!shape || !shape.points || shape.points.length < 3) return;

    const spacingMeters = parseFloat(document.getElementById('lineSpacing').value) || 10;
    const manualShift = parseFloat(document.getElementById('startOffset').value) || 0;

    try {
        // 1. Створюємо масив координат та ОБОВ'ЯЗКОВО замикаємо його
        const coords = shape.points.map(p => [p.lng, p.lat]);
        const closedCoords = [...coords, coords[0]]; // Додаємо копію першої точки в кінець

        const poly = turf.polygon([closedCoords]);
        const bbox = turf.bbox(poly);

        const p1 = turf.point([shape.points[0].lng, shape.points[0].lat]);
        const p2 = turf.point([shape.points[1].lng, shape.points[1].lat]);
        const bearing = turf.bearing(p1, p2);

        const diag = turf.distance(
            turf.point([bbox[0], bbox[1]]),
            turf.point([bbox[2], bbox[3]]),
            { units: 'meters' }
        );

        let lines = [];

        // Функція створення лінії (тепер повертає просту лінію, без обрізки по полю)
        function getRawLine(offset) {
            const origin = p1;
            const shiftedStart = turf.destination(origin, offset, bearing + 90, { units: 'meters' });
            const shiftedEnd = turf.destination(shiftedStart, diag * 3, bearing, { units: 'meters' });
            const shiftedBack = turf.destination(shiftedStart, -diag * 3, bearing, { units: 'meters' });
            return [shiftedBack.geometry.coordinates, shiftedEnd.geometry.coordinates];
        }

        // 1. Генеруємо лінії з великим запасом (diag * 2), щоб покрити все поле + залишки
        for (let offset = manualShift - (Math.ceil(diag / spacingMeters) + 1) * spacingMeters;
            offset < diag * 2;
            offset += spacingMeters) {
            lines.push(getRawLine(offset));
        }
        console.log(`Генерація: створено ${lines.length} базових ліній`);
        const strips = [];

        // 2. Створюємо смуги шляхом перетину "нескінченних" прямокутників із полем
        for (let i = 0; i < lines.length - 1; i++) {
            const line1 = lines[i];
            const line2 = lines[i + 1];

            // Формуємо прямокутник між двома лініями
            const rectangleCoords = [
                line1[0], line1[1],
                line2[1], line2[0],
                line1[0]
            ];

            try {
                const rectanglePoly = turf.polygon([rectangleCoords]);

                // ПРАВИЛЬНО: Передаємо масив з двох об'єктів [poly, rectanglePoly]
                const intersected = turf.intersect(turf.featureCollection([poly, rectanglePoly]));

                if (intersected) {
                    const parts = intersected.geometry.type === 'MultiPolygon'
                        ? intersected.geometry.coordinates
                        : [intersected.geometry.coordinates];

                    parts.forEach(coords => strips.push(coords));
                }
            } catch (e) {
                console.warn("Помилка обробки сегмента:", i);
                console.log(e);
            }
        }

        console.log(`Результат: сформовано ${strips.length} окремих смуг`);
        shape.internalStrips = strips;
        saveData();
        updateUI();

    } catch (error) {
        console.error("Помилка генерації:", error);
    }
}

function toggleLiveTracking() {
    const trackBtn = document.getElementById('trackBtn');
    isTrackingActive = !isTrackingActive; // Перемикаємо режим

    if (isTrackingActive) {
        trackBtn.classList.add('active');
        trackBtn.innerText = "🛰️";
        if (lastLocation) map.panTo([lastLocation.lat, lastLocation.lng]);
    } else {
        trackBtn.classList.remove('active');
        trackBtn.innerText = "📍";
    }
}


function renderTrack() {
    // 1. Очищуємо старий трек з карти
    if (trackLayer) {
        map.removeLayer(trackLayer);
        trackLayer = null;
    }

    // 2. Шукаємо активне поле
    const activeShape = shapes.find(s => s.id === activeShapeId);

    // 3. Малюємо, якщо є точки
    if (activeShape && activeShape.trackPoints && activeShape.trackPoints.length > 1) {
        trackLayer = L.polyline(activeShape.trackPoints, {
            color: '#d3a31f',      // ВАШ НОВИЙ КОЛІР
            weight: getTrackWeight(),
            opacity: 0.6,          // Трохи збільшив прозорість для кращої видимості
            lineCap: 'round',
            lineJoin: 'round',
            interactive: false
        }).addTo(map);
    }
}



function updateCompletedStats() {
    const shape = shapes.find(s => s.id === activeShapeId);
    const statsElem = document.getElementById('completedArea');

    console.log("Оновлення статистики для поля:", shape ? shape.name : "не знайдено");

    if (!shape || !statsElem) return;

    let totalCompletedArea = 0;

    if (shape.internalStrips && shape.completedStrips) {
        Object.keys(shape.completedStrips).forEach(index => {
            if (shape.completedStrips[index]) {
                const stripCoords = shape.internalStrips[index];
                if (stripCoords) {
                    try {
                        // Важливо: переконайтеся, що turf.polygon отримує правильний масив
                        const poly = turf.polygon(stripCoords);
                        totalCompletedArea += turf.area(poly);
                    } catch (e) {
                        console.error("Помилка розрахунку смуги:", index, e);
                    }
                }
            }
        });
    }

    const ha = totalCompletedArea / 10000;
    console.log("Разом оброблено га:", ha);
    statsElem.innerText = ha.toFixed(4);
}

function deleteLines() {
    const shape = shapes.find(s => s.id === activeShapeId);
    if (shape) {
        if (confirm('Видалити всі колії та дані про обробку для цього поля?')) {
            shape.internalStrips = [];
            shape.completedStrips = {}; // Скидаємо також статус обробки
            saveData();
            updateUI();
            updateCompletedStats();
        }
    }
}

// --- ЕКСПОРТ У ФАЙЛ ---
function exportData() {
    if (shapes.length === 0) return alert("Немає даних для експорту");

    const dataStr = JSON.stringify(shapes, null, 2);
    const dataUri = 'data:application/json;charset=utf-8,' + encodeURIComponent(dataStr);

    const exportFileDefaultName = 'map_project_backup_' + new Date().toLocaleDateString() + '.json';

    const linkElement = document.createElement('a');
    linkElement.setAttribute('href', dataUri);
    linkElement.setAttribute('download', exportFileDefaultName);
    linkElement.click();
}

// --- ІМПОРТ З ФАЙЛУ ---
function importData(event) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = function (e) {
        try {
            const importedShapes = JSON.parse(e.target.result);

            if (Array.isArray(importedShapes)) {
                if (confirm("Замінити поточні дані імпортованими?")) {
                    shapes = importedShapes;
                    saveData();
                    renderShapes();
                    updateUI();
                    alert("Дані успішно імпортовано!");
                }
            } else {
                alert("Некоректний формат файлу");
            }
        } catch (err) {
            alert("Помилка при читанні файлу");
            console.error(err);
        }
    };
    reader.readAsText(file);
    // Очищуємо інпут, щоб можна було вибрати той самий файл двічі
    event.target.value = '';
}

function toggleSidebar() {
    const sidebar = document.getElementById('sidebar');
    sidebar.classList.toggle('hidden');
}

function clearTrack() {
    const activeShape = shapes.find(s => s.id === activeShapeId);
    if (activeShape && confirm("Видалити намальований шлях для цього поля?")) {
        activeShape.trackPoints = [];
        if (trackLayer) map.removeLayer(trackLayer);
        trackLayer = null;
        saveData();
        alert("Трек очищено");
    }
}

function getTrackWeight() {
    const spacing = parseFloat(document.getElementById('lineSpacing').value) || 10;
    // Розрахунок: скільки пікселів займає 1 метр при поточному зумі
    const centerLatLng = map.getCenter();
    const pointC = map.latLngToContainerPoint(centerLatLng);
    const pointDest = map.unproject(map.project(centerLatLng).add([0, 100])); // 100 пікселів вниз
    const distanceInMeters = centerLatLng.distanceTo(pointDest);
    const pixelsPerMeter = 100 / distanceInMeters;

    return spacing * pixelsPerMeter;
}

map.on('zoomend', () => {
    if (trackLayer) {
        trackLayer.setStyle({ weight: getTrackWeight() });
    }
});

function startGlobalGPS() {
    if (!navigator.geolocation) return;

    watchId = navigator.geolocation.watchPosition(
        (position) => {
            const { latitude: lat, longitude: lng, accuracy, heading, speed } = position.coords;
            const currentTimestamp = position.timestamp;
            const speedValue = document.getElementById('speedValue');

            // 1. ОНОВЛЕННЯ СПІДОМЕТРА (завжди)
            let calculatedSpeed = speed;
            if ((calculatedSpeed === null || calculatedSpeed === 0) && lastLocation && lastTimestamp) {
                const start = turf.point([lastLocation.lng, lastLocation.lat]);
                const end = turf.point([lng, lat]);
                const distance = turf.distance(start, end, { units: 'kilometers' });
                const timeHours = (currentTimestamp - lastTimestamp) / (1000 * 60 * 60);
                if (timeHours > 0) calculatedSpeed = (distance / timeHours) / 3.6;
            }
            if (speedValue) {
                speedValue.innerText = calculatedSpeed ? (calculatedSpeed * 3.6).toFixed(1) : "0.0";
            }

            // 2. ОНОВЛЕННЯ МАРКЕРА (завжди)
            let rotation = 0;
            if (heading !== null && heading !== undefined) {
                rotation = heading;
            } else if (lastLocation) {
                rotation = turf.bearing(turf.point([lastLocation.lng, lastLocation.lat]), turf.point([lng, lat]));
            }

            if (myLocationMarker) map.removeLayer(myLocationMarker);
            myLocationMarker = L.layerGroup().addTo(map);
            L.circle([lat, lng], { radius: accuracy, weight: 1, color: '#3498db', fillOpacity: 0.1 }).addTo(myLocationMarker);
            const arrowIcon = L.divIcon({
                className: 'location-arrow',
                html: `<div class="arrow-icon" style="transform: rotate(${rotation}deg)"></div>`,
                iconSize: [20, 20],
                iconAnchor: [10, 10]
            });
            L.marker([lat, lng], { icon: arrowIcon }).addTo(myLocationMarker);

            // 3. ЗАПИС ТРЕКУ ТА КАМЕРА (тільки якщо натиснуто "Стежити")
            if (isTrackingActive) {
                const activeShape = shapes.find(s => s.id === activeShapeId);
                if (activeShape) {
                    // --- 1. ЗАПИС ТРЕКУ (Ваш існуючий код) ---
                    if (!activeShape.trackPoints) activeShape.trackPoints = [];
                    const newPoint = [lat, lng];
                    let shouldAdd = false;
                    if (activeShape.trackPoints.length === 0) {
                        shouldAdd = true;
                    } else {
                        const lastP = activeShape.trackPoints[activeShape.trackPoints.length - 1];
                        const dist = turf.distance(turf.point([lastP[1], lastP[0]]), turf.point([lng, lat]), { units: 'meters' });
                        if (dist > 5) shouldAdd = true;
                    }
                    if (shouldAdd) {
                        activeShape.trackPoints.push(newPoint);
                        renderTrack();
                        saveData();
                    }

                    // --- 2. АВТОМАТИЧНЕ ЗАФАРБОВУВАННЯ (Додаємо сюди) ---
                    if (activeShape.internalStrips) {
                        const myPos = turf.point([lng, lat]);
                        const trackWidth = parseFloat(document.getElementById('lineSpacing').value) || 10;

                        activeShape.internalStrips.forEach((stripCoords, index) => {
                            if (activeShape.completedStrips[index]) return;

                            if (!sessionProgress[index]) {
                                sessionProgress[index] = {
                                    points: getControlPoints(stripCoords),
                                    hitCount: 0,
                                    hits: new Array(10).fill(false)
                                };
                            }

                            const data = sessionProgress[index];
                            data.points.forEach((cp, i) => {
                                if (!data.hits[i]) {
                                    const dist = turf.distance(myPos, turf.point(cp), { units: 'meters' });
                                    // Реєструємо "влучання", якщо ми в радіусі 70% від ширини захвату
                                    if (dist < (trackWidth * 0.7)) {
                                        data.hits[i] = true;
                                        data.hitCount++;
                                    }
                                }
                            });

                            if (data.hitCount >= 7) {
                                activeShape.completedStrips[index] = true;
                                delete sessionProgress[index];
                                updateUI(); // Оновлюємо карту, щоб смуга стала зеленою
                                updateCompletedStats(); // Оновлюємо га
                                saveData();
                            }
                        });
                    }
                }
                map.panTo([lat, lng]);
            }


            lastLocation = { lat, lng };
            lastTimestamp = currentTimestamp;
        },
        (error) => console.warn(error),
        { enableHighAccuracy: true, maximumAge: 1000, timeout: 10000 }
    );
}

function getControlPoints(stripCoords) {
    try {
        const poly = turf.polygon(stripCoords);
        const line = turf.lineString([stripCoords[0][0], stripCoords[0][3]]); // Приблизна центральна лінія
        const points = [];
        const length = turf.length(line);

        for (let i = 1; i <= 10; i++) {
            const segment = (length / 11) * i;
            points.push(turf.along(line, segment).geometry.coordinates);
        }
        return points;
    } catch (e) { return []; }
}
