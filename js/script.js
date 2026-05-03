let watchId = null;
let myLocationMarker = null;
let lastLocation = null;
let lastTimestamp = null;
let currentTrackPoints = []; // Масив для точок поточного треку
let trackLayer = null;      // Шар на карті для малювання
const savedShapes = localStorage.getItem('savedShapes');
// const shapes = savedShapes ? JSON.parse(savedShapes) : [];
let shapes = JSON.parse(localStorage.getItem('savedShapes')) || [];
let trackCalcTimeout = null;

// 2. Потім завантажуємо ID і ВІДРАЗУ перевіряємо, чи таке поле існує
const savedId = localStorage.getItem('activeShapeId');
// Якщо ID є в базі — беремо його, якщо ні — ставимо null
let activeShapeId = null;

let markers = [];
let leafletPolygons = {}; // Об'єкт для зберігання малюнків полігонів
let isTrackingActive = false; // Прапорець для запису треку та руху камери
let sessionProgress = {};
let isNewSegmentStarting = false;

const colorPicker = document.getElementById('colorPicker');

let isRotateMode = false;

let smoothLat = null;
let smoothLng = null;
const SMOOTHING_FACTOR = 0.25;


// Константи шарів (карта та супутник)
// 1. Звичайна карта (OpenStreetMap)
const streetLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 22,        // До якого рівня можна крутити коліщатко
    maxNativeZoom: 19,  // Максимальний рівень, який реально є у сервера (зазвичай 19)
    attribution: '© OpenStreetMap'
});

// 2. Супутник Google (lyrs=s — супутник, lyrs=y — гібрид з підписами)
const satelliteLayer = L.tileLayer('https://{s}.google.com/vt/lyrs=y&x={x}&y={y}&z={z}', {
    maxZoom: 22,
    maxNativeZoom: 20,  // У Google Satellite зазвичай є 20 рівнів
    subdomains: ['mt0', 'mt1', 'mt2', 'mt3'],
    attribution: '© Google Maps'
});


// Визначаємо, який шар був збережений (за замовчуванням - вулиці)
let currentLayerType = localStorage.getItem('mapLayerType') || 'streets';

// Створення карти з урахуванням збереженого шару
const map = L.map('map', {
    center: [
        localStorage.getItem('mapLat') || 49.00,
        localStorage.getItem('mapLng') || 31.00
    ],
    zoom: localStorage.getItem('mapZoom') || 13,
    rotate: true,
    touchRotate: true,
    rotateControl: false,

    // Ключові зміни для "гумовості":
    zoomAnimation: true,      // Вимикаємо "картинну" анімацію, щоб вектори не зависали
    fadeAnimation: true,
    markerZoomAnimation: false,
    inertia: false,            // Прибираємо інерцію, щоб карта зупинялася миттєво за пальцями

    renderer: L.svg({
        padding: 1,            // Збільшуємо зону малювання
        tolerance: 10          // Покращуємо продуктивність
    }),
    doubleClickZoom: false,
    zoomSnap: 0,               // Дозволяє будь-який рівень зуму (наприклад 15.123)
    zoomDelta: 0.1,
    maxZoom: 22,
    layers: [currentLayerType === 'satellite' ? satelliteLayer : streetLayer]
});
renderShapes();

// Функція миттєвого перемальовування
function forceSyncVectors() {
    if (map.renderer && map.renderer._update) {
        map.renderer._update();
    }
}

map.on('zoom rotate', function () {
    // 1. Повідомляємо рендереру, що потрібно оновити координати
    if (map.renderer) map.renderer._update();

    // 2. ХАК: Емулюємо завершення зуму, щоб Leaflet перерахував вектори
    map.fire('zoomend');

    // 3. Якщо використовується плагін обертання, примусово оновлюємо його контейнер
    if (map.getPanes().mapPane) {
        map.getPanes().mapPane.style.transform = map.getPanes().mapPane.style.transform;
    }
});
map.on('dblclick', function (e) {
    // Наближаємо на 1.5 рівня від поточного (оптимально для Agro-Map)
    const currentZoom = map.getZoom();
    map.setZoom(currentZoom + 1, {
        animate: true
    });
});


// Створюємо кастомний контроль для компаса
const CompassControl = L.Control.extend({
    options: { position: 'bottomright' }, // Розташування
    onAdd: function (map) {
        const div = L.DomUtil.create('div', 'compass-control');
        div.innerHTML = '<div id="compassArrow" class="compass-arrow"></div>';

        // При натисканні на компас - повертаємо карту на північ
        div.onclick = function () {
            if (map.setBearing) {
                map.setBearing(0);
            } else {
                map.setView(map.getCenter(), map.getZoom()); // Якщо немає плагіна обертання
            }
        };
        return div;
    }
});

map.addControl(new CompassControl());

// 1. Подія, яка спрацьовує на кожному мікро-кадрі руху карти
map.on('rotate', function () {
    const arrow = document.getElementById('compassArrow');
    if (arrow) {
        const bearing = map.getBearing();
        // Просто крутимо вісь
        arrow.style.transform = `rotate(${bearing}deg)`;
    }
});

// 2. Функція плавного повернення
function resetNorth() {
    if (typeof map.setBearing !== 'function') return;

    let startBearing = map.getBearing();

    // 1. Нормалізуємо кут, щоб він був у межах [-180, 180]
    // Це змусить карту розуміти, що 350° — це насправді -10°
    let targetDiff = ((startBearing + 180) % 360 + 360) % 360 - 180;

    const duration = 800; // 0.8 секунди
    const startTime = performance.now();

    function animate(currentTime) {
        const elapsed = currentTime - startTime;
        const progress = Math.min(elapsed / duration, 1);

        // Функція плавності (Ease Out)
        const ease = 1 - Math.pow(1 - progress, 3);

        // Розраховуємо новий кут, віднімаючи частину "різниці"
        const currentBearing = startBearing - (targetDiff * ease);

        map.setBearing(currentBearing);

        if (progress < 1) {
            requestAnimationFrame(animate);
        } else {
            map.setBearing(0); // Фінальна фіксація в нуль
        }
    }

    requestAnimationFrame(animate);
}

let currentAnimateBearing = 0;
let rotationRequestIdx = 0;
function smoothRotate(targetBearing) {
    if (typeof map.setBearing !== 'function') return;

    let startBearing = map.getBearing();
    // Обчислюємо найкоротший шлях до цілі (щоб не крутитись на 350 градусів)
    let diff = (targetBearing - startBearing + 540) % 360 - 180;

    if (Math.abs(diff) < 0.1) return; // Якщо різниця мізерна — не смикаємо

    const duration = 600; // Трохи швидше, ніж скидання на північ
    const startTime = performance.now();
    const requestId = ++rotationRequestIdx; // Щоб нові анімації зупиняли старі

    function animate(currentTime) {
        if (requestId !== rotationRequestIdx) return; // Зупиняємо, якщо прийшов новий кут

        const elapsed = currentTime - startTime;
        const progress = Math.min(elapsed / duration, 1);
        const ease = 1 - Math.pow(1 - progress, 3);

        const currentBearing = startBearing + (diff * ease);
        map.setBearing(currentBearing);

        if (progress < 1) {
            requestAnimationFrame(animate);
        }
    }
    requestAnimationFrame(animate);
}


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





function init() {
    // 1. СУВОРА ПЕРЕВІРКА ДАНИХ ПЕРЕД РЕНДЕРОМ
    const savedId = localStorage.getItem('activeShapeId');

    // Перевіряємо, чи є такий ID у масиві shapes (який вже має бути завантажений глобально)
    // Якщо ID — це рядок "null" або поля не існує, скидаємо в null
    if (savedId && shapes.some(s => s.id === savedId)) {
        activeShapeId = savedId;
    } else {
        activeShapeId = null;
        localStorage.removeItem('activeShapeId'); // Чистимо сміття ("null")
    }

    // 2. НАЛАШТУВАННЯ ШАРІВ КАРТИ
    const savedLayer = localStorage.getItem('mapLayerType') || 'streets';
    const btn = document.getElementById('layerBtn');
    if (btn) {
        btn.innerText = (savedLayer === 'satellite') ? '🗺️' : '🛰️';
    }


    // 3. ОНОВЛЕННЯ ІНТЕРФЕЙСУ (саме в такому порядку)
    renderShapes(); // Тут кнопка "Стежити" отримає свій стан disabled/enabled
    updateUI();     // Оновлення списків та статистики

    // 4. ВІЗУАЛІЗАЦІЯ ТРЕКУ
    if (activeShapeId) {
        renderTrack();
        // focusOnShape(); // Можна додати, щоб карта відразу центрувалася на полі
    }

    // 5. ЗАПУСК СЕРВІСІВ
    startGlobalGPS();
    const trackBtn = document.getElementById('trackBtn');
    if (!activeShapeId) {
        trackBtn.disabled = true;
        trackBtn.setAttribute('disabled', 'disabled');
        trackBtn.style.opacity = "0.5";
    }
    if (map) {
        setTimeout(() => {
            map.invalidateSize({ animate: true });
        }, 200); // невелика затримка, щоб браузер встиг відрендерити layout
    }
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
    const sidebar = document.getElementById('sidebar');
    sidebar.classList.remove('list-active');
    sidebar.classList.add('edit-active');

    // Заповнюємо дані у поля
    document.getElementById('editingFieldName').innerText = shape.name || "Поле";
    document.getElementById('shapeNameInput').value = shape.name || "";
    document.getElementById('colorPicker').value = shape.color || "#2980b9";
    document.getElementById('lineSpacing').value = shape.lineSpacing !== undefined ? shape.lineSpacing : 10;
    document.getElementById('startOffset').value = shape.startOffset !== undefined ? shape.startOffset : 0;
    document.getElementById('view-list').style.display = 'none';
    document.getElementById('view-edit').style.display = 'block';
}

function showListView() {
    const sidebar = document.getElementById('sidebar');
    sidebar.classList.remove('edit-active');
    sidebar.classList.add('list-active');

    // 1. Скидаємо навігаційні режими
    isTrackingActive = false;
    isRotateMode = false;
    if (typeof map.setBearing === 'function') {
        map.setBearing(0);
    }

    const trackBtn = document.getElementById('trackBtn');
    if (trackBtn) {
        trackBtn.classList.remove('active');
        trackBtn.innerText = "📍";
    }

    // 2. Скидаємо стан активного поля
    activeShapeId = null;
    localStorage.removeItem('activeShapeId');

    const trackAreaEl = document.getElementById('trackArea');
    if (trackAreaEl) trackAreaEl.innerText = "0.0000 га";

    // 3. Відображення інтерфейсу
    document.getElementById('view-list').style.display = 'block';
    document.getElementById('view-edit').style.display = 'none';

    renderShapes();
    updateUI();

    if (trackLayer) {
        trackLayer.clearLayers();
    }

    // // 4. АВТОЦЕНТРУВАННЯ (на основі всіх полів)
    // if (shapes && shapes.length > 0) {
    //     try {
    //         let allPoints = [];

    //         // Збираємо ВСІ точки з усіх полів в один масив
    //         shapes.forEach(shape => {
    //             if (shape.points && Array.isArray(shape.points)) {
    //                 shape.points.forEach(p => {
    //                     if (p.lat && p.lng) {
    //                         allPoints.push([p.lat, p.lng]);
    //                     }
    //                 });
    //             }
    //         });

    //         if (allPoints.length > 0) {
    //             const allBounds = L.latLngBounds(allPoints);
    //             map.fitBounds(allBounds, {
    //                 padding: [50, 50],
    //                 maxZoom: 16, // Щоб не наближало занадто сильно до одного поля
    //                 animate: true
    //             });
    //         }
    //     } catch (e) {
    //         console.error("Помилка фокусування на списку полів:", e);
    //     }
    // }
}

function renderShapes() {
    const container = document.getElementById('shapes-list');
    const trackBtn = document.getElementById('trackBtn');
    const controls = document.getElementById('active-shape-controls');

    if (!container) return;
    container.innerHTML = '';

    // --- КЛЮЧОВИЙ МОМЕНТ: Перевірка стану при кожному рендері ---
    const activeFieldExists = shapes.some(s => s.id === activeShapeId);

    if (activeShapeId && activeFieldExists) {
        trackBtn.disabled = false;
        trackBtn.style.opacity = "1";
        trackBtn.style.pointerEvents = "auto";
        if (controls) controls.style.display = 'flex';
    } else {
        trackBtn.disabled = true;
        trackBtn.style.opacity = "0.5";
        trackBtn.style.pointerEvents = "none";
        if (controls) controls.style.display = 'none';
        // Якщо поле не існує, скидаємо ID в справжній null
        if (!activeFieldExists) activeShapeId = null;
        saveData();
    }

    shapes.forEach(shape => {
        const btn = document.createElement('button');
        btn.className = `shape-btn ${shape.id === activeShapeId ? 'active' : ''}`;

        btn.innerHTML = `
            <div class="shape-btn-content">
                <span class="color-indicator" style="background-color: ${shape.color || '#3498db'}"></span>
                <span class="shape-name">${shape.name || 'Без назви'}</span>
            </div>
        `;

        btn.onclick = () => {
            activeShapeId = shape.id; // Встановлюємо ID
            const trackAreaEl = document.getElementById('trackArea');
            if (trackAreaEl) trackAreaEl.innerText = "0.0000 га";
            // 1. Оновлюємо візуальний стан списку та кнопки "Стежити"
            renderShapes();

            // 2. Викликаємо ваші стандартні функції
            if (typeof calculateArea === 'function') calculateArea(shape);

            const colorPicker = document.getElementById('colorPicker');
            if (colorPicker) colorPicker.value = shape.color;

            saveData();

            // 3. ПЕРЕХІД В ДЕТАЛІ (Переконайтеся, що ця функція викликається)
            if (typeof showEditView === 'function') {
                showEditView(shape);
            }

            if (typeof updateUI === 'function') updateUI();
            if (typeof updateCompletedStats === 'function') updateCompletedStats();

            renderTrack();
            if (typeof focusOnShape === 'function') focusOnShape();
        };

        container.appendChild(btn);
    });
    updateTrackStats();
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
                        layer.stripIndex = index;
                        const stripHa = turf.area(feature) / 10000;
                        const tooltipText = `Смуга №${index + 1}: ${stripHa.toFixed(4)} га`;

                        layer.on('mouseover', function (e) {
                            // --- ПЕРЕВІРКА ---
                            if (shape.id !== activeShapeId) return;

                            // 1. ПОКАЗУЄМО ПІДКАЗКУ (тільки для активного поля)
                            this.bindTooltip(tooltipText, {
                                sticky: true,
                                direction: 'top'
                            }).openTooltip();

                            // 2. СКИДАННЯ СТИЛІВ ІНШИХ СМУГ (ваш існуючий код)
                            map.eachLayer(l => {
                                if (l.isStrip && l.options) {
                                    const lIndex = l.stripIndex;
                                    const lCompleted = shape.completedStrips && shape.completedStrips[lIndex];
                                    if (l !== this) {
                                        l.setStyle({
                                            fillOpacity: lCompleted ? 0.6 : 0.15,
                                            weight: lCompleted ? 2 : 1,
                                            color: lCompleted ? '#27ae60' : shape.color
                                        });
                                    }
                                }
                            });

                            // 3. ПІДСВІТКА ПОТОЧНОЇ СМУГИ
                            const isNowCompleted = shape.completedStrips && shape.completedStrips[index];
                            this.setStyle({
                                fillOpacity: isNowCompleted ? 0.8 : 0.4,
                                weight: 3,
                                color: '#ffffff'
                            });
                        });

                        layer.on('mouseout', function (e) {
                            // --- ПЕРЕВІРКА ---
                            if (shape.id !== activeShapeId) return;

                            // ЗАКРИВАЄМО ТА ВІДВ'ЯЗУЄМО ПІДКАЗКУ (щоб не лишалася на неактивних полях)
                            this.closeTooltip();
                            this.unbindTooltip();

                            const isNowCompleted = shape.completedStrips && shape.completedStrips[index];
                            this.setStyle({
                                fillOpacity: isNowCompleted ? 0.6 : 0.15,
                                weight: isNowCompleted ? 2 : 1,
                                color: isNowCompleted ? '#27ae60' : shape.color
                            });
                        });

                        layer.on('click', function (e) {
                            L.DomEvent.stopPropagation(e);

                            // --- ДОДАЄМО ПЕРЕВІРКУ ---
                            // Якщо це поле не є активним, ми забороняємо ручне відмічання смуг
                            if (shape.id !== activeShapeId) {
                                console.warn("Ці колії належать іншому полю. Спочатку виберіть його у списку.");
                                return;
                            }

                            // Знімаємо фокус з елемента
                            if (this.getElement()) {
                                this.getElement().blur();
                            }

                            if (!shape.completedStrips) shape.completedStrips = {};

                            // Перемикаємо статус
                            shape.completedStrips[index] = !shape.completedStrips[index];

                            // Оновлюємо стиль поточної смуги
                            const isNowCompleted = shape.completedStrips[index];
                            this.setStyle({
                                color: isNowCompleted ? '#27ae60' : shape.color,
                                fillColor: isNowCompleted ? '#2ecc71' : shape.color,
                                fillOpacity: isNowCompleted ? 0.6 : 0.15,
                                weight: isNowCompleted ? 2 : 1,
                                dashArray: isNowCompleted ? '' : '5, 5' // Смуга стає суцільною, якщо виконана
                            });

                            updateCompletedStats();
                            saveData();
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
        // 1. Оптимізація координат перед збереженням (зменшуємо розмір JSON у 2-3 рази)
        const optimizedShapes = shapes.map(shape => {
            const newShape = { ...shape };
            if (newShape.trackSegments) {
                newShape.trackSegments = newShape.trackSegments.map(segment =>
                    segment.map(point => [
                        Math.round(point[0] * 1000000) / 1000000, // 6 знаків після коми
                        Math.round(point[1] * 1000000) / 1000000
                    ])
                );
            }
            return newShape;
        });

        localStorage.setItem('savedShapes', JSON.stringify(optimizedShapes));

        // 3. Дані карти
        if (typeof map !== 'undefined' && map !== null) {
            const center = map.getCenter();
            localStorage.setItem('mapLat', center.lat.toFixed(6));
            localStorage.setItem('mapLng', center.lng.toFixed(6));
            localStorage.setItem('mapZoom', map.getZoom());
        }

        console.log("Дані успішно збережено.");
    } catch (e) {
        console.error("Помилка збереження:", e);

        // Показуємо алерт тільки якщо це дійсно переповнення квоти
        if (e.name === 'QuotaExceededError' || e.code === 22) {
            alert("Пам'ять LocalStorage переповнена! Видаліть старі треки або зменште кількість полів.");
        }
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

    // Отримуємо кут з інтерфейсу (додайте input id="manualAngle")
    const manualAngle = parseFloat(document.getElementById('manualAngle').value) || 0;
    const spacingMeters = parseFloat(document.getElementById('lineSpacing').value) || 10;
    const manualShift = parseFloat(document.getElementById('startOffset').value) || 0;

    try {
        const coords = shape.points.map(p => [p.lng, p.lat]);
        const closedCoords = [...coords, coords[0]];
        const poly = turf.polygon([closedCoords]);
        const bbox = turf.bbox(poly);
        const center = turf.center(poly); // Центр поля — точка опори

        // Діагональ для гарантованого покриття при будь-якому куті
        const diag = turf.distance(
            turf.point([bbox[0], bbox[1]]),
            turf.point([bbox[2], bbox[3]]),
            { units: 'meters' }
        ) * 2;

        const bearing = manualAngle; // Використовуємо заданий кут
        let lines = [];

        // Функція створення лінії відносно центру
        function getRawLine(offset) {
            // Зміщуємося від центру перпендикулярно курсу (bearing + 90)
            const origin = turf.destination(center, offset, bearing + 90, { units: 'meters' });
            // Малюємо лінію вперед і назад по курсу
            const start = turf.destination(origin, -diag, bearing, { units: 'meters' });
            const end = turf.destination(origin, diag, bearing, { units: 'meters' });
            return [start.geometry.coordinates, end.geometry.coordinates];
        }

        // Генеруємо лінії в обидва боки від центру, щоб покрити весь BBox
        const halfCount = Math.ceil(diag / spacingMeters);
        for (let i = -halfCount; i <= halfCount; i++) {
            const offset = (i * spacingMeters) + manualShift;
            lines.push(getRawLine(offset));
        }

        const strips = [];
        for (let i = 0; i < lines.length - 1; i++) {
            const rectangleCoords = [lines[i][0], lines[i][1], lines[i + 1][1], lines[i + 1][0], lines[i][0]];
            try {
                const rectanglePoly = turf.polygon([rectangleCoords]);
                const intersected = turf.intersect(turf.featureCollection([poly, rectanglePoly]));
                if (intersected) {
                    const parts = intersected.geometry.type === 'MultiPolygon'
                        ? intersected.geometry.coordinates
                        : [intersected.geometry.coordinates];
                    parts.forEach(coords => strips.push(coords));
                }
            } catch (e) { continue; }
        }

        shape.internalStrips = strips;
        saveData();
        updateUI();
    } catch (error) {
        console.error("Помилка генерації:", error);
    }
}


// function toggleLiveTracking() {
//     const trackBtn = document.getElementById('trackBtn');
//     isTrackingActive = !isTrackingActive;

//     if (isTrackingActive) {
//         trackBtn.classList.add('active');
//         trackBtn.innerText = "🛰️";

//         // КЛЮЧОВИЙ МОМЕНТ: Сигналимо, що наступна точка — це новий сегмент
//         isNewSegmentStarting = true;

//         if (lastLocation) map.panTo([lastLocation.lat, lastLocation.lng]);
//     } else {
//         trackBtn.classList.remove('active');
//         trackBtn.innerText = "📍";

//         // При вимкненні також корисно скинути стан
//         isNewSegmentStarting = false;
//     }
// }
function toggleLiveTracking() {
    const trackBtn = document.getElementById('trackBtn');
    isTrackingActive = !isTrackingActive;

    if (isTrackingActive) {
        trackBtn.classList.add('active');
        trackBtn.innerText = "🛰️";

        // 1. Знаходимо активне поле
        const activeShape = shapes.find(s => s.id === activeShapeId);

        // 2. Якщо ми в полі і маємо координати, створюємо сегмент з першою точкою відразу
        if (activeShape && lastLocation) {
            if (!activeShape.trackSegments) activeShape.trackSegments = [];

            // Додаємо новий сегмент, в якому вже лежить поточна точка
            activeShape.trackSegments.push([[lastLocation.lat, lastLocation.lng]]);

            // Скидаємо прапорець, бо сегмент вже створено вручну
            isNewSegmentStarting = false;

            saveData();
            map.panTo([lastLocation.lat, lastLocation.lng]);
        } else {
            // Якщо координат ще немає, просто сигналізуємо про початок
            isNewSegmentStarting = true;
        }

    } else {
        trackBtn.classList.remove('active');
        trackBtn.innerText = "📍";
        isNewSegmentStarting = false;
    }
}



function renderTrack() {
    // 1. Очищуємо старий трек (групу шарів) з карти
    if (trackLayer) {
        map.removeLayer(trackLayer);
    }

    // Створюємо нову групу для всіх сегментів треку
    trackLayer = L.layerGroup().addTo(map);

    // 2. Шукаємо активне поле
    const activeShape = shapes.find(s => s.id === activeShapeId);

    // 3. Малюємо кожен сегмент окремо
    if (activeShape && activeShape.trackSegments && activeShape.trackSegments.length > 0) {
        activeShape.trackSegments.forEach(segment => {
            // Малюємо лінію, тільки якщо в сегменті хоча б 2 точки
            if (segment.length > 1) {
                L.polyline(segment, {
                    color: '#d3a31f',
                    weight: getTrackWeight(),
                    opacity: 0.6,
                    lineCap: 'round',
                    lineJoin: 'round',
                    interactive: false
                }).addTo(trackLayer);
            }
        });
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

function exportSingleShape(id) {
    const shape = shapes.find(s => s.id === id);
    if (!shape) return alert("Поле не знайдено");

    // Створюємо масив з одним об'єктом, щоб зберегти сумісність з форматом імпорту
    const dataStr = JSON.stringify([shape], null, 2);
    const dataUri = 'data:application/json;charset=utf-8,' + encodeURIComponent(dataStr);

    const fileName = `Field_${shape.name || 'unnamed'}_${new Date().toISOString().slice(0, 10)}.json`;

    const linkElement = document.createElement('a');
    linkElement.setAttribute('href', dataUri);
    linkElement.setAttribute('download', fileName);
    linkElement.click();
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


function importData(event) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = function (e) {
        try {
            const importedData = JSON.parse(e.target.result);
            // Перетворюємо в масив, навіть якщо у файлі один об'єкт
            const newShapes = Array.isArray(importedData) ? importedData : [importedData];

            newShapes.forEach(newShape => {
                // Перевіряємо, чи немає вже поля з таким ID
                const isDuplicate = shapes.some(s => s.id === newShape.id);

                if (isDuplicate) {
                    // Якщо ID вже існує, створюємо новий унікальний ID
                    newShape.id = Date.now().toString() + '-' + Math.floor(Math.random() * 1000);
                    newShape.name = (newShape.name || "Поле") + " (копія)";
                }

                // Додаємо поле в загальний масив
                shapes.push(newShape);
            });

            // Зберігаємо оновлений масив у LocalStorage
            saveData();
            // Оновлюємо інтерфейс
            renderShapes();
            if (typeof updateUI === 'function') updateUI();

            alert(`Успішно додано полів: ${newShapes.length}`);

        } catch (err) {
            alert("Помилка: файл має некоректний формат JSON");
            console.error(err);
        }
    };
    reader.readAsText(file);
    // Очищуємо поле вибору файлу
    event.target.value = '';
}


function toggleSidebar() {
    const sidebar = document.getElementById('sidebar');
    sidebar.classList.toggle('hidden');
}

function clearTrack() {
    const activeShape = shapes.find(s => s.id === activeShapeId);

    if (activeShape && confirm("Видалити намальований шлях для цього поля?")) {
        // 1. Очищаємо нову структуру сегментів
        activeShape.trackSegments = [];

        // 2. На всякий випадок очищаємо і старий масив, якщо він був
        if (activeShape.trackPoints) activeShape.trackPoints = [];

        // 3. Очищаємо візуалізацію з карти
        if (trackLayer) {
            // Якщо trackLayer це L.layerGroup, clearLayers() видалить усі лінії відразу
            if (typeof trackLayer.clearLayers === 'function') {
                trackLayer.clearLayers();
            } else {
                map.removeLayer(trackLayer);
                trackLayer = null;
            }
        }

        // 4. Зберігаємо зміни та оновлюємо UI
        saveData();

        // Якщо у вас є функція оновлення статистики (га), варто викликати її тут
        if (typeof updateCompletedStats === 'function') updateCompletedStats();

        // alert("Трек очищено");
    }
    updateTrackStats();
}

function getTrackWeight() {
    const spacing = parseFloat(document.getElementById('lineSpacing').value) || 10;
    const center = map.getCenter();

    // Створюємо точку поруч (на 0.001 градуса широти вище)
    const offsetLatLng = L.latLng(center.lat + 0.001, center.lng);

    // Рахуємо реальну відстань у метрах між цими точками
    const distanceMeters = center.distanceTo(offsetLatLng);

    // Рахуємо відстань у пікселях на екрані
    const p1 = map.latLngToLayerPoint(center);
    const p2 = map.latLngToLayerPoint(offsetLatLng);
    const distancePixels = p1.distanceTo(p2);

    // Коефіцієнт: скільки пікселів в одному метрі
    const pixelsPerMeter = distancePixels / distanceMeters;

    // Повертаємо ширину в пікселях (мінімум 1 піксель, щоб не зникав)
    return Math.max(spacing * pixelsPerMeter, 1);
}

map.on('zoomend', () => {
    if (trackLayer) {
        const newWeight = getTrackWeight();

        // Перебираємо всі лінії всередині групи і оновлюємо кожну
        trackLayer.eachLayer((layer) => {
            if (layer instanceof L.Polyline) {
                layer.setStyle({ weight: newWeight });
            }
        });
    }
});

function startGlobalGPS() {
    if (!navigator.geolocation) return;

    watchId = navigator.geolocation.watchPosition(
        (position) => {
            // const { latitude: lat, longitude: lng, accuracy, heading, speed } = position.coords;

            const rawLat = position.coords.latitude;
            const rawLng = position.coords.longitude;
            const { accuracy, heading, speed } = position.coords;

            // 1. ФІЛЬТРАЦІЯ КООРДИНАТ (Smoothing)
            if (smoothLat === null || smoothLng === null) {
                smoothLat = rawLat;
                smoothLng = rawLng;
            } else {
                // Математичне згладжування (Exponential Moving Average)
                smoothLat = (smoothLat * (1 - SMOOTHING_FACTOR)) + (rawLat * SMOOTHING_FACTOR);
                smoothLng = (smoothLng * (1 - SMOOTHING_FACTOR)) + (rawLng * SMOOTHING_FACTOR);
            }

            // Тепер використовуємо відфільтровані координати для всього додатку
            const lat = smoothLat;
            const lng = smoothLng;

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
            const speedKmH = calculatedSpeed ? (calculatedSpeed * 3.6) : 0;
            if (speedValue) {
                speedValue.innerText = calculatedSpeed ? (calculatedSpeed * 3.6).toFixed(1) : "0.0";
            }
            const isMoving = speedKmH > 1.5;

            // 1. Розрахунок кута (Heading)
            let rotation = (window.lastRotation !== undefined) ? window.lastRotation : 0;
            if (isMoving) {
                if (heading !== null && heading !== undefined && !isNaN(heading)) {
                    rotation = heading;
                } else if (lastLocation) {
                    rotation = turf.bearing(
                        turf.point([lastLocation.lng, lastLocation.lat]),
                        turf.point([lng, lat])
                    );
                } window.lastRotation = rotation; // Запам'ятовуємо останній стабільний курс
            }
            // rotation — це ваш вхідний кут
            let displayDegrees = Math.round((((360 - rotation) % 360) + 360) % 360);


            // 2. Оновлення цифр у панелі
            const headingElement = document.getElementById('headingValue');
            if (headingElement) {
                headingElement.textContent = displayDegrees;
            }

            let finalRotation = (rotation + 360) % 360;

            // 2. Логіка режимів
            let iconDisplayRotation = isRotateMode ? 0 : finalRotation;

            if (isRotateMode) {
                // ВАЖЛИВО: Передаємо МІНУС rotation, щоб карта розвернулася ходом ВГОРУ
                if (isMoving) { smoothRotate(-finalRotation); }

                // Стрілка завжди дивиться в лоб (0° відносно екрана)
                iconDisplayRotation = 0;

                // Використовуємо panTo, синхронізуючи час (0.6с як у вашому smoothRotate)
                map.panTo([lat, lng], { animate: true, duration: 0.6 });
            } else {
                // Якщо режим ротації вимкнено — повертаємо карту на Північ (0)
                smoothRotate(0);

                // Стрілка крутиться за курсом GPS
                iconDisplayRotation = finalRotation;

                // Якщо активоване просто стеження (📍), рухаємо карту за трактором
                if (isTrackingActive) {
                    map.panTo([lat, lng], { animate: true, duration: 0.6 });
                }
            }

            // 3. Оновлення маркера (ЗБІЛЬШЕНО ВТРИЧІ)
            if (myLocationMarker) map.removeLayer(myLocationMarker);
            myLocationMarker = L.layerGroup().addTo(map);

            const bigArrowIcon = L.divIcon({
                className: 'location-arrow-container',
                html: `
        <div style="transform: rotate(${iconDisplayRotation}deg); width: 96px; height: 96px; display: flex; justify-content: center; align-items: center;">
            <img src="styles/images/arrow.svg" style="width: 100%; height: 100%; display: block;">
        </div>`,
                iconSize: [96, 96],
                iconAnchor: [48, 48] // Центр іконки 96/2
            });

            L.marker([lat, lng], { icon: bigArrowIcon }).addTo(myLocationMarker);

            if (isRotateMode || isTrackingActive) {
                // isRotateMode — ваш режим "носом вгору"
                // isTrackingActive — якщо у вас є окрема кнопка "Стежити" (📍)

                map.setView([lat, lng], map.getZoom(), {
                    animate: true,
                    pan: {
                        duration: 0.5 // Робить рух карти до трактора плавним
                    }
                });
            }

            // 3. ЗАПИС ТРЕКУ ТА КАМЕРА (тільки якщо натиснуто "Стежити")
            if (isTrackingActive) {
                const activeShape = shapes.find(s => s.id === activeShapeId);
                if (activeShape) {
                    // 1. Ініціалізація структури сегментів
                    if (!activeShape.trackSegments) activeShape.trackSegments = [];

                    // 2. Створення нового сегмента при старті стеження
                    if (isNewSegmentStarting || activeShape.trackSegments.length === 0) {
                        activeShape.trackSegments.push([]);
                        isNewSegmentStarting = false; // Важливо: скидаємо прапорець
                    }

                    // Отримуємо посилання на поточний (останній) сегмент
                    const currentSegments = activeShape.trackSegments;
                    const currentSegment = currentSegments[currentSegments.length - 1];
                    const newPoint = [lat, lng];

                    // 3. Перевірка на додавання точки (мінімум 5 метрів від попередньої)
                    let shouldAdd = false;
                    if (currentSegment.length === 0) {
                        shouldAdd = true;
                    } else {
                        const lastP = currentSegment[currentSegment.length - 1];
                        // Turf очікує [lng, lat], тому беремо індекси [1] та [0]
                        const from = turf.point([lastP[1], lastP[0]]);
                        const to = turf.point([lng, lat]);
                        const dist = turf.distance(from, to, { units: 'meters' });

                        if (dist > 5) shouldAdd = true;
                    }

                    if (shouldAdd) {
                        currentSegment.push(newPoint);
                        saveData();
                        renderTrack(); // Малює всі сегменти окремими лініями                        
                        updateTrackStats();
                    }

                    // --- 4. АВТОМАТИЧНЕ ЗАФАРБОВУВАННЯ ---
                    if (activeShape.internalStrips) {
                        const myPos = turf.point([lng, lat]);
                        const trackWidth = parseFloat(document.getElementById('lineSpacing').value) || 10;

                        activeShape.internalStrips.forEach((stripCoords, index) => {
                            if (activeShape.completedStrips && activeShape.completedStrips[index]) return;

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
                                    if (dist < (trackWidth * 0.7)) {
                                        data.hits[i] = true;
                                        data.hitCount++;
                                    }
                                }
                            });

                            if (data.hitCount >= 7) {
                                if (!activeShape.completedStrips) activeShape.completedStrips = {};
                                activeShape.completedStrips[index] = true;
                                delete sessionProgress[index];

                                if (typeof updateUI === 'function') updateUI();
                                if (typeof updateCompletedStats === 'function') updateCompletedStats();
                                saveData();
                            }
                        });
                    }
                }
                // Плавно переміщуємо камеру за маркером
                map.panTo([lat, lng]);
            }



            lastLocation = { lat, lng };
            lastTimestamp = currentTimestamp;
            if (isRotateMode && rotation !== undefined) {
                // rotation — це кут, який ми вже розрахували раніше
                map.setBearing(rotation);
            }
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

function updateTrackStats() {
    if (trackCalcTimeout) clearTimeout(trackCalcTimeout);

    trackCalcTimeout = setTimeout(() => {
        const activeShape = shapes.find(s => s.id === activeShapeId);
        const trackAreaEl = document.getElementById('trackArea');

        if (!activeShape || !activeShape.trackSegments || activeShape.trackSegments.length === 0) {
            if (trackAreaEl) trackAreaEl.innerText = "0.0000 га";
            return;
        }

        try {
            const trackWidth = parseFloat(document.getElementById('lineSpacing').value) || 10;

            // 1. Отримуємо координати з вашого масиву 'points'
            if (!activeShape.points || activeShape.points.length < 3) {
                console.error("Недостатньо точок у полі для розрахунку");
                return;
            }

            // Перетворюємо {lat, lng} у [lng, lat]
            let coords = activeShape.points.map(p => [p.lng, p.lat]);

            // 2. Важливо: Turf вимагає, щоб перша і остання точки збігалися
            if (coords[0][0] !== coords[coords.length - 1][0] || coords[0][1] !== coords[coords.length - 1][1]) {
                coords.push([coords[0][0], coords[0][1]]);
            }

            // Створюємо полігон (масив має бути загорнутий у ще один масив)
            const fieldPoly = turf.polygon([coords]);

            let features = [];

            // 3. Обробляємо треки
            activeShape.trackSegments.forEach(segment => {
                if (segment.length < 2) return;

                // Перевертаємо точки треку [lat, lng] -> [lng, lat]
                const lineCoords = segment.map(p => [p[1], p[0]]);
                let line = turf.lineString(lineCoords);

                // Спрощуємо для швидкості
                line = turf.simplify(line, { tolerance: 0.00001, highQuality: false });

                const buffer = turf.buffer(line, trackWidth / 2, { units: 'meters' });
                if (buffer) features.push(buffer);
            });

            if (features.length === 0) return;

            // 4. Об'єднуємо треки та шукаємо перетин із полем
            const combinedTrack = turf.union(turf.featureCollection(features));
            if (!combinedTrack) return;

            const intersection = turf.intersect(turf.featureCollection([combinedTrack, fieldPoly]));

            if (intersection) {
                const areaHa = turf.area(intersection) / 10000;
                trackAreaEl.innerText = areaHa.toFixed(4) + " га";
            } else {
                trackAreaEl.innerText = "0.0000 га";
            }
        } catch (e) {
            console.warn("Помилка обробки геометрії:", e.message);
        }
    }, 1000);
}

function toggleEditField() {
    const editField = document.getElementsByClassName('edit-field')[0];
    editField.classList.toggle('hidden');
}



function toggleRotateMode() {
    isRotateMode = !isRotateMode;
    const btn = document.getElementById('rotateModeBtn');

    if (isRotateMode) {
        btn.style.borderColor = '#2ecc71';
        btn.style.color = '#2ecc71';
        btn.innerText = '🔼'; // Символ "носом вгору"
    } else {
        btn.style.borderColor = '#555';
        btn.style.color = 'white';
        btn.innerText = '🧭';
        map.setBearing(0); // Повертаємо мапу на Північ при вимкненні
    }
}

function setAngleFromGPS() {
    // Беремо відкаліброване значення з вашої панелі (0-359)
    const currentHeading = document.getElementById('headingValue').textContent;

    // Перевіряємо, чи є значення і чи воно не нульове (якщо техніка стоїть)
    if (currentHeading && currentHeading !== "—") {
        const angleInput = document.getElementById('manualAngle');
        angleInput.value = currentHeading;

        // Викликаємо ваші функції збереження та перегенерації
        saveLineParams();
        if (typeof generateLines === 'function') {
            generateLines();
        }

        // Візуальний ефект успіху (кнопка на мить блимне зеленим)
        console.log(`Кут встановлено: ${currentHeading}°`);
    } else {
        alert("Напрямок не визначений. Почніть рух!");
    }
}






