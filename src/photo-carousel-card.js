import { LitElement, html, css } from 'lit';

function processPhotoTimestamp(photo) {
    let timestamp;

    if (photo.time_stamp) {
        let tsString = String(photo.time_stamp);

        // Regex to detect ISO 8601 like YYYY-MM-DDTHH:MM:SS (or .sss) WITHOUT a timezone indicator (Z, +HH:MM, -HH:MM).
        // If it matches, append 'Z' to treat it as UTC, preventing potential local time interpretation issues.
        if (tsString.match(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?$/)) {
            tsString += 'Z';
        }

        timestamp = new Date(tsString);

        // If Date parsing results in an 'Invalid Date', default to current time
        if (isNaN(timestamp.getTime())) {
            console.warn(`Photo Carousel Card: Invalid timestamp format for photo "${photo.img || photo.desc || 'unknown'}". Received "${photo.time_stamp}". Defaulting to current time.`);
            timestamp = new Date(); // Default to current time if parsing fails
        }
    } else {
        // If time_stamp is not provided, default to the current time (now)
        timestamp = new Date();
    }

    // Return the photo object with the processed timestamp
    return { ...photo, timestamp: timestamp };
}

class PhotoCarouselCard extends LitElement {
    static properties = {
        hass: {},
        config: {},
        _currentSlideIndex: { type: Number },
        _totalSlides: { type: Number },
        _autoplayInterval: { type: Object },
        _reloadInterval: { type: Object }, 
        _processedPhotos: { type: Array },
        max_items_to_show: { type: Number },
        max_days_to_show: { type: Number },
        title_style: { type: Object },
        timestamp_style: { type: Object },
        description_style: { type: Object },
        _startX: { type: Number },
        _endX: { type: Number },
        _swipeThreshold: { type: Number },
        _isDragging: { type: Boolean },
        _originalTrackTransition: { type: String },
    };

    constructor() {
        super();
        this._currentSlideIndex = 0;
        this._totalSlides = 0;
        this._autoplayInterval = null;
        this._reloadInterval = null;
        this._processedPhotos = [];
        this.max_items_to_show = 30;
        this.max_days_to_show = 0;
        this.title_style = {
            show_title: true,
            font_color: null,
            font_size: null,
        };
        this.timestamp_style = {
            show_timestamp: true,
            font_color: null,
            font_size: null,
        };
        this.description_style = {
            show_description: true,
            font_color: null,
            font_size: null,
        };
        this._startX = 0;
        this._endX = 0;
        this._swipeThreshold = 50; // Minimum horizontal pixels to register a swipe

        // NEW: Initialize dragging properties
        this._isDragging = false;
        this._originalTrackTransition = '';

        // Bind event handlers to 'this'
        this._handleTouchStartBound = this._handleTouchStart.bind(this);
        this._handleTouchMoveBound = this._handleTouchMove.bind(this);
        this._handleTouchEndBound = this._handleTouchEnd.bind(this);

        // NEW: Bind mouse event handlers
        this._handleMouseDownBound = this._handleMouseDown.bind(this);
        this._handleMouseMoveBound = this._handleMouseMove.bind(this);
        this._handleMouseUpBound = this._handleMouseUp.bind(this);
    }

    static styles = css`
        .carousel-container {
            position: relative;
            width: 100%;
            overflow: hidden;
            border-radius: 8px;
            box-shadow: 0 4px 8px rgba(0, 0, 0, 0.1);
            background-color: var(--card-background-color, #ffffff);
            touch-action: pan-y; 
            cursor: grab; /* Indicate it's draggable */
        }

        .carousel-container.is-dragging {
            cursor: grabbing; /* Indicate currently dragging */
        }

        .carousel-track {
            display: flex;
            transition: transform 0.5s ease-in-out;
            width: 100%;
        }

        .carousel-slide {
            flex: 0 0 100%;
            box-sizing: border-box;
            text-align: center;
            padding: 10px;
            display: flex;
            flex-direction: column;
            justify-content: center;
            align-items: center;
            min-height: 200px;
            user-select: none; 
            -webkit-user-select: none;
            -moz-user-select: none;
            -ms-user-select: none;
            -webkit-user-drag: none; /* Prevent browser default image drag */
        }

        .carousel-slide img {
            max-width: 100%;
            height: auto;
            /* max-height: 300px; */
            border-radius: 6px;
            object-fit: contain;
            margin-bottom: 10px;
            pointer-events: none; /* Prevents image dragging by default */
        }

        .carousel-slide .caption {
            font-size: var(--photo-carousel-card-description-font-size, 0.9em);
            color: var(--photo-carousel-card-description-color, var(--primary-text-color));
            text-align: center;
            padding: 0 5px;
        }

        .carousel-slide .timestamp {
            font-size: var(--photo-carousel-card-timestamp-font-size, 0.85em);
            color: var(--photo-carousel-card-timestamp-color, var(--secondary-text-color));
            margin-bottom: 5px; 
            text-align: center;
        }

        .custom-card-title {
            padding: 16px 16px 0 16px; 
            text-align: center;
            font-size: var(--photo-carousel-card-title-font-size, 1.2em); 
            color: var(--photo-carousel-card-title-color, var(--primary-text-color)); 
            font-weight: bold; 
        }

        .carousel-button {
            position: absolute;
            top: 50%;
            transform: translateY(-50%);
            background-color: rgba(0, 0, 0, 0.5);
            color: white;
            border: none;
            padding: 10px 15px;
            cursor: pointer;
            font-size: 1.5em;
            border-radius: 50%;
            z-index: 10;
            transition: background-color 0.3s ease;
            display: flex;
            align-items: center;
            justify-content: center;
            width: 40px;
            height: 40px;
            box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
        }

        .carousel-button:hover {
            background-color: rgba(0, 0, 0, 0.7);
        }

        .carousel-button.prev {
            left: 10px;
        }

        .carousel-button.next {
            right: 10px;
        }

        .carousel-pagination {
            position: absolute;
            bottom: 10px;
            left: 50%;
            transform: translateX(-50%);
            display: flex;
            gap: 8px;
            z-index: 10;
        }

        .pagination-dot {
            width: 10px;
            height: 10px;
            background-color: rgba(255, 255, 255, 0.5);
            border-radius: 50%;
            cursor: pointer;
            transition: background-color 0.3s ease;
        }

        .pagination-dot.active {
            background-color: var(--primary-color, #007aff);
        }

        .card-content {
            padding: 0 16px 16px 16px; 
        }
    `;

 async setConfig(config) {
        this.config = config;
        this._currentSlideIndex = 0;

        this.max_items_to_show = typeof config.max_items_to_show === 'number' && config.max_items_to_show >= 0
            ? config.max_items_to_show : 30;
        this.max_days_to_show = typeof config.max_days_to_show === 'number' && config.max_days_to_show >= 0
            ? config.max_days_to_show : 0;

        const defaultTitleStyle = {
            show_title: true,
            font_color: null,
            font_size: null,
        };
        this.title_style = { ...defaultTitleStyle, ...(config.title_style || {}) };
        if (this.title_style.show_title === undefined) {
            this.title_style.show_title = true;
        }

        const defaultTimestampStyle = {
            show_timestamp: true,
            font_color: null,
            font_size: null,
        };
        this.timestamp_style = { ...defaultTimestampStyle, ...(config.timestamp_style || {}) };
        if (this.timestamp_style.show_timestamp === undefined) {
            this.timestamp_style.show_timestamp = true;
        }

        const defaultDescriptionStyle = {
            show_description: true,
            font_color: null,
            font_size: null,
        };
        this.description_style = { ...defaultDescriptionStyle, ...(config.description_style || {}) };
        if (this.description_style.show_description === undefined) {
            this.description_style.show_description = true;
        }

        this._stopReloadInterval();

        let tempRawPhotos = []; // This will hold photos after initial loading, before timestamp processing

        // --- Load photos from description_file_path ---
        if (config.description_file_path && String(config.description_file_path).trim() !== '') {
            try {
                const url = `${config.description_file_path}?_t=${new Date().getTime()}`;
                const response = await fetch(url);
                if (!response.ok) {
                    throw new Error(`Failed to fetch description file: ${response.statusText}`);
                }

                const contentType = response.headers.get('content-type');
                const isJson = (contentType && contentType.includes('application/json')) ||
                               (config.description_file_path.toLowerCase().endsWith('.json'));

                if (isJson) {
                    const jsonData = await response.json();
                    if (Array.isArray(jsonData)) {
                        tempRawPhotos = jsonData.map(item => ({
                            img: item.img,
                            desc: item.desc || '',
                            time_stamp: item.time_stamp || null // Preserve original time_stamp here
                        }));
                    } else {
                        console.warn("JSON file content is not a valid array:", jsonData);
                    }
                } else { // Handle .txt file parsing
                    if (!config.folder_path) {
                        console.error("Configuration error: 'folder_path' is missing when a non-JSON 'description_file_path' is used.");
                        throw new Error('You need to define a "folder_path" for images when using a non-JSON "description_file_path".');
                    }
                    const text = await response.text();
                    const folderPath = config.folder_path.endsWith('/') ? config.folder_path : `${config.folder_path}/`;
                    text.split('\n').forEach(line => {
                        const parts = line.split('|');
                        if (parts.length >= 1 && parts[0].trim() !== '') {
                            const filename = parts[0].trim();
                            const description = parts.length >= 2 ? parts.slice(1).join('|').trim() : '';
                            // Note: .txt files usually don't have time_stamp in this format, so it remains null
                            tempRawPhotos.push({
                                img: `${folderPath}${filename}`,
                                desc: description,
                                time_stamp: null
                            });
                        }
                    });
                }

            } catch (error) {
                console.error("Error loading description file or processing images from file:", error);
            }
        }

        // --- If no photos from file, try inline 'photos' property ---
        if (tempRawPhotos.length === 0 && config.photos && Array.isArray(config.photos) && config.photos.length > 0) {
            tempRawPhotos = config.photos.map(photo => ({
                img: photo.img,
                desc: photo.desc || '',
                time_stamp: photo.time_stamp || null // Preserve original time_stamp here
            }));
        }
        
        // --- Process timestamps for all loaded photos ---
        // This is where the new timestamp logic is applied to every photo
        const processedPhotosWithTimestamps = tempRawPhotos.map(processPhotoTimestamp);


        if (processedPhotosWithTimestamps.length === 0) {
            console.error("Configuration error: No photos found from either 'description_file_path' or 'photos' property.");
            throw new Error('No photos configured. Please provide images via "description_file_path" or "photos" property.');
        }

        // --- Apply filtering and sorting ---
        let filteredPhotos = processedPhotosWithTimestamps;

        if (this.max_days_to_show > 0) {
            const cutoffDate = new Date();
            // This sets cutoffDate to the beginning of the day 'max_days_to_show' days ago
            cutoffDate.setDate(cutoffDate.getDate() - this.max_days_to_show);
            cutoffDate.setHours(0, 0, 0, 0);

            filteredPhotos = filteredPhotos.filter(photo => {
                // photo.timestamp is already a valid Date object or defaulted to 'now'
                // No need for try-catch here as parsing was done by processPhotoTimestamp
                return photo.timestamp >= cutoffDate;
            });
            console.log(`Filtered by max_days_to_show (${this.max_days_to_show} days): ${filteredPhotos.length} photos remaining.`);
        }
        
        // Sort photos by timestamp (most recent first)
        // This ensures max_items_to_show gets the newest photos if there are too many
        filteredPhotos.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());


        if (this.max_items_to_show > 0 && filteredPhotos.length > this.max_items_to_show) {
            filteredPhotos = filteredPhotos.slice(0, this.max_items_to_show);
            console.log(`Filtered by max_items_to_show (${this.max_items_to_show} items): ${filteredPhotos.length} photos remaining.`);
        }

        this._processedPhotos = filteredPhotos;
        this._totalSlides = this._processedPhotos.length;

        this.requestUpdate();

        this._startReloadInterval();
    }

    _formatTimestamp(isoString) {
        if (!isoString) return '';
        try {
            const date = new Date(isoString);
            return new Intl.DateTimeFormat(navigator.language, {
                year: 'numeric',
                month: 'short', 
                day: 'numeric',
                hour: 'numeric',
                minute: '2-digit',
                second: '2-digit', 
                hour12: true 
            }).format(date);
        } catch (e) {
            console.error("Error parsing or formatting timestamp:", isoString, e);
            return isoString; 
        }
    }

    firstUpdated(changedProperties) {
        console.log("firstUpdated lifecycle called. Initializing custom carousel.");
        this.updateComplete.then(() => { 
            this.initializeCarousel();
            console.log("firstUpdated finished.");
        });
    }

    updated(changedProperties) {
        if (changedProperties.has('_processedPhotos') && this._processedPhotos.length > 0) {
            console.log("Processed photos updated. Re-initializing carousel.");
            this.initializeCarousel();
        } else if (changedProperties.has('_currentSlideIndex') && this._carouselTrack) {
            this.updateCarouselDisplay();
        }
    }

    initializeCarousel() {
        console.log("initializeCarousel called.");
        this._carouselTrack = this.shadowRoot.querySelector('.carousel-track');
        this._carouselContainer = this.shadowRoot.querySelector('.carousel-container'); // Get container for touch events
        this._prevButton = this.shadowRoot.querySelector('.carousel-button.prev');
        this._nextButton = this.shadowRoot.querySelector('.carousel-button.next');
        this._paginationContainer = this.shadowRoot.querySelector('.carousel-pagination');

        if (!this._carouselTrack || !this._carouselContainer || !this._prevButton || !this._nextButton || !this._paginationContainer) {
            console.error("Carousel elements not found in shadow DOM! Cannot initialize custom carousel.");
            return;
        }

        // Remove existing listeners to prevent duplicates
        if (this._prevButton._hasClickListener) {
            this._prevButton.removeEventListener('click', this._prevSlideBound);
            this._nextButton.removeEventListener('click', this._nextSlideBound);
            this._carouselContainer.removeEventListener('touchstart', this._handleTouchStartBound);
            this._carouselContainer.removeEventListener('touchmove', this._handleTouchMoveBound);
            this._carouselContainer.removeEventListener('touchend', this._handleTouchEndBound);
            // NEW: Remove mouse listeners from container (mousedown)
            this._carouselContainer.removeEventListener('mousedown', this._handleMouseDownBound);
            // IMPORTANT: Mousemove and mouseup are on window/document, remove them if they exist
            window.removeEventListener('mousemove', this._handleMouseMoveBound);
            window.removeEventListener('mouseup', this._handleMouseUpBound);
        }

        this._prevSlideBound = this._prevSlide.bind(this);
        this._nextSlideBound = this._nextSlide.bind(this);

        this._prevButton.addEventListener('click', this._prevSlideBound);
        this._nextButton.addEventListener('click', this._nextSlideBound);
        this._prevButton._hasClickListener = true; // Mark as having listeners

        // Add touch event listeners to the carousel container
        this._carouselContainer.addEventListener('touchstart', this._handleTouchStartBound, { passive: true });
        this._carouselContainer.addEventListener('touchmove', this._handleTouchMoveBound, { passive: false });
        this._carouselContainer.addEventListener('touchend', this._handleTouchEndBound);

        // NEW: Add mouse event listener to the carousel container
        this._carouselContainer.addEventListener('mousedown', this._handleMouseDownBound);


        this.createPaginationDots();
        this.updateCarouselDisplay();
        this.startAutoplay();
        console.log("initializeCarousel finished.");
    }

    createPaginationDots() {
        if (!this._paginationContainer) return;
        this._paginationContainer.innerHTML = '';

        for (let i = 0; i < this._totalSlides; i++) {
            const dot = document.createElement('span');
            dot.classList.add('pagination-dot');
            if (i === this._currentSlideIndex) {
                dot.classList.add('active');
            }
            dot.dataset.index = i;
            dot.addEventListener('click', (e) => {
                this.showSlide(parseInt(e.target.dataset.index, 10));
            });
            this._paginationContainer.appendChild(dot);
        }
    }

    updateCarouselDisplay() {
        if (!this._carouselTrack) return;

        const translateX = -this._currentSlideIndex * 100;
        this._carouselTrack.style.transform = `translateX(${translateX}%)`;
        // Ensure transition is active when updating the display normally
        this._carouselTrack.style.transition = this._originalTrackTransition || 'transform 0.5s ease-in-out';

        this.shadowRoot.querySelectorAll('.pagination-dot').forEach((dot, index) => {
            if (index === this._currentSlideIndex) {
                dot.classList.add('active');
            } else {
                dot.classList.remove('active');
            }
        });
        console.log(`Updated carousel display to slide: ${this._currentSlideIndex}`);
    }

    _nextSlide() {
        console.log("Next slide triggered.");
        this.stopAutoplay();
        if (this._totalSlides > 0) {
            this._currentSlideIndex = (this._currentSlideIndex + 1) % this._totalSlides;
        } else {
            this._currentSlideIndex = 0; // Ensure 0 if no slides
        }
        this.requestUpdate();
        this.startAutoplay();
    }

    _prevSlide() {
        console.log("Previous slide triggered.");
        this.stopAutoplay();
        if (this._totalSlides > 0) {
            this._currentSlideIndex = (this._currentSlideIndex - 1 + this._totalSlides) % this._totalSlides;
        } else {
            this._currentSlideIndex = 0; // Ensure 0 if no slides
        }
        this.requestUpdate();
        this.startAutoplay();
    }

    startAutoplay() {
        this.stopAutoplay();
        const autoplayDelay = this.config.autoplay === false ? 0 : (typeof this.config.autoplay === 'number' ? this.config.autoplay : 5000);

        if (autoplayDelay > 0 && this._totalSlides > 1) {
            this._autoplayInterval = setInterval(() => {
                this._nextSlide();
            }, autoplayDelay);
            console.log(`Autoplay started with delay: ${autoplayDelay}ms`);
        } else {
            console.log("Autoplay is disabled or not enough slides.");
        }
    }

    stopAutoplay() {
        if (this._autoplayInterval) {
            clearInterval(this._autoplayInterval);
            this._autoplayInterval = null;
            console.log("Autoplay stopped.");
        }
    }

    showSlide(index) {
        if (index < 0 || index >= this._totalSlides) {
            console.warn(`Attempted to show invalid slide index: ${index}`);
            return;
        }
        this.stopAutoplay();
        this._currentSlideIndex = index;
        this.requestUpdate();
        this.startAutoplay();
    }

    _startReloadInterval() {
        this._stopReloadInterval();

        const reloadMinutes = parseFloat(this.config.reload_interval_minutes);
        if (!isNaN(reloadMinutes) && reloadMinutes > 0) {
            const reloadMilliseconds = reloadMinutes * 60 * 1000;
            this._reloadInterval = setInterval(() => {
                console.log(`Reloading description file at ${reloadMinutes} minute interval.`);
                this.setConfig(this.config); 
            }, reloadMilliseconds);
            console.log(`Reload interval started: every ${reloadMinutes} minutes.`);
        } else {
            console.log("Reload interval not configured or invalid.");
        }
    }

    _stopReloadInterval() {
        if (this._reloadInterval) {
            clearInterval(this._reloadInterval);
            this._reloadInterval = null;
            console.log("Reload interval stopped.");
        }
    }

    // Touch event handlers (unchanged)
    _handleTouchStart(event) {
        this._startX = event.touches[0].clientX;
        this.stopAutoplay(); 
        console.log("Touch start at X:", this._startX);
    }

    _handleTouchMove(event) {
        event.preventDefault(); 
        this._endX = event.touches[0].clientX; 
    }

    _handleTouchEnd(event) {
        this._endX = event.changedTouches[0].clientX;
        const diffX = this._startX - this._endX;
        console.log(`Touch end. StartX: ${this._startX}, EndX: ${this._endX}, DiffX: ${diffX}`);

        if (Math.abs(diffX) > this._swipeThreshold) {
            if (diffX > 0) { 
                this._nextSlide();
            } else { 
                this._prevSlide();
            }
        }
        this.startAutoplay(); 
    }

    // NEW: Mouse event handlers
    _handleMouseDown(event) {
        // Only trigger on left mouse button
        if (event.button !== 0) return; 

        this._isDragging = true;
        this._startX = event.clientX;
        this.stopAutoplay();
        
        // Store original transition and set to none for smooth dragging
        this._originalTrackTransition = this._carouselTrack.style.transition;
        this._carouselTrack.style.transition = 'none';

        // Add mousemove and mouseup listeners to the window
        // This ensures events are captured even if the mouse leaves the carousel area
        window.addEventListener('mousemove', this._handleMouseMoveBound);
        window.addEventListener('mouseup', this._handleMouseUpBound);

        this._carouselContainer.classList.add('is-dragging'); // Add class for cursor style
        event.preventDefault(); // Prevent default browser drag behavior (e.g., image dragging, text selection)
        console.log("Mouse down at X:", this._startX);
    }

    _handleMouseMove(event) {
        if (!this._isDragging) return;

        const currentX = event.clientX;
        const dragDelta = currentX - this._startX; // How much the mouse has moved

        // Calculate the base transform for the current slide
        const baseTranslateX = -this._currentSlideIndex * 100; // e.g., -0%, -100%, -200%

        // Apply a temporary transform that combines the base position and the drag offset
        this._carouselTrack.style.transform = `translateX(calc(${baseTranslateX}% + ${dragDelta}px))`;
        
        event.preventDefault(); // Prevent text selection while dragging
    }

    _handleMouseUp(event) {
        if (!this._isDragging) return;

        this._isDragging = false;
        this._carouselContainer.classList.remove('is-dragging'); // Remove dragging class

        // Remove mousemove and mouseup listeners from window
        window.removeEventListener('mousemove', this._handleMouseMoveBound);
        window.removeEventListener('mouseup', this._handleMouseUpBound);

        const finalDiffX = this._startX - event.clientX; // Calculate total horizontal movement
        console.log(`Mouse up. StartX: ${this._startX}, EndX: ${event.clientX}, DiffX: ${finalDiffX}`);

        if (Math.abs(finalDiffX) > this._swipeThreshold) {
            if (finalDiffX > 0) { // Dragged left (start X > end X)
                this._nextSlide();
            } else { // Dragged right (start X < end X)
                this._prevSlide();
            }
        } else {
            // If no significant swipe, snap back to the current slide's position
            // This re-applies the original transform with transition
            this.updateCarouselDisplay(); 
        }

        // Restore original transition property after determining the final slide
        this._carouselTrack.style.transition = this._originalTrackTransition;
        this.startAutoplay();
        event.preventDefault(); // Prevent default action (e.g., click event if not swiped)
    }

    render() {
        
        const cardTitleText = this.config.title || "Photo Carousel"; 
        const shouldShowTitle = this.title_style.show_title && cardTitleText && String(cardTitleText).trim() !== "";

        if (!this._processedPhotos || this._processedPhotos.length === 0) {
            console.log("render: No processed photos, rendering empty message.");
            return html`
                <ha-card>
                    <div class="card-content">
                        ${shouldShowTitle ? html`
                            <div class="custom-card-title" 
                                style="${this.title_style.font_size ? `font-size: ${this.title_style.font_size};` : ''} 
                                       ${this.title_style.font_color ? `color: ${this.title_style.font_color};` : ''}">
                                ${cardTitleText}
                            </div>
                        ` : ''}
                        <p>No photos found or loaded from the description file or 'photos' property.</p>
                        <p>Please check your configuration or filters.</p>
                    </div>
                </ha-card>
            `;
        }

        return html`
            <ha-card>
                <div class="card-content">
                    ${shouldShowTitle ? html`
                        <div class="custom-card-title" 
                            style="${this.title_style.font_size ? `font-size: ${this.title_style.font_size};` : ''} 
                                   ${this.title_style.font_color ? `color: ${this.title_style.font_color};` : ''}">
                            ${cardTitleText}
                        </div>
                    ` : ''}

                    <div class="carousel-container">
                        <div class="carousel-track" style="transform: translateX(-${this._currentSlideIndex * 100}%)">
                            ${this._processedPhotos.map(photo => html`
                                <div class="carousel-slide">
                                    ${this.timestamp_style.show_timestamp && photo.time_stamp ? 
                                        html`<p class="timestamp"
                                            style="${this.timestamp_style.font_size ? `font-size: ${this.timestamp_style.font_size};` : ''} 
                                                   ${this.timestamp_style.font_color ? `color: ${this.timestamp_style.font_color};` : ''}">
                                            ${this._formatTimestamp(photo.time_stamp)}
                                        </p>` 
                                        : ''}
                                    <img src="${photo.img}" alt="${photo.desc || 'Photo'}">
                                    ${this.description_style.show_description && photo.desc ? html`
                                        <p class="caption"
                                            style="${this.description_style.font_size ? `font-size: ${this.description_style.font_size};` : ''} 
                                                   ${this.description_style.font_color ? `color: ${this.description_style.font_color};` : ''}">
                                            ${photo.desc}
                                        </p>` 
                                        : ''}
                                </div>
                            `)}
                        </div>
                        
                        <button class="carousel-button prev" aria-label="Previous slide">
                            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-chevron-left"><path d="m15 18-6-6 6-6"/></svg>
                        </button>
                        <button class="carousel-button next" aria-label="Next slide">
                            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucude-chevron-right"><path d="m9 18 6-6-6-6"/></svg>
                        </button>

                        <div class="carousel-pagination"></div>
                    </div>
                </div>
            </ha-card>
        `;
    }

    disconnectedCallback() {
        console.log("disconnectedCallback called. Cleaning up custom carousel.");
        this.stopAutoplay();
        this._stopReloadInterval();

        if (this._prevButton && this._prevButton._hasClickListener) {
            this._prevButton.removeEventListener('click', this._prevSlideBound);
            this._nextButton.removeEventListener('click', this._nextSlideBound);
            
            if (this._carouselContainer) {
                // Remove touch listeners
                this._carouselContainer.removeEventListener('touchstart', this._handleTouchStartBound);
                this._carouselContainer.removeEventListener('touchmove', this._handleTouchMoveBound);
                this._carouselContainer.removeEventListener('touchend', this._handleTouchEndBound);
                // Remove mousedown listener from container
                this._carouselContainer.removeEventListener('mousedown', this._handleMouseDownBound);
            }
            // Ensure mousemove/mouseup are removed from window/document if they were attached
            window.removeEventListener('mousemove', this._handleMouseMoveBound);
            window.removeEventListener('mouseup', this._handleMouseUpBound);
        }
        super.disconnectedCallback();
        console.log("disconnectedCallback finished.");
    }
}

if (!customElements.get('photo-carousel-card')) {
    console.debug("Registering custom element: photo-carousel-card");
    customElements.define('photo-carousel-card', PhotoCarouselCard);

    window.customCards = window.customCards || [];
    window.customCards.push({
    type: 'photo-carousel-card',
    name: 'Photo Carousel Card',
    description: 'A photo viewer card for showcasing photos in a customizable carousel, featuring flexible data sourcing, extensive styling options, and intuitive mouse/touch navigations.'
    });

} else {
    console.debug("Custom element photo-carousel-card already registered.");
}