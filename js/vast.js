//https://github.com/dailymotion/vast-client-js
//https://github.com/MailOnline/videojs-vast-vpaid
radioplayer.vast = {
	DEBUG: true,
  enabled: false,
  vastTag: '',
  videoPlayerId: 'vast-video',
	timeout: 5000,
	failTimeoutTime: 10000,
	closeTimeout: null,
	vastSize: {
		width: 720,
		height: radioplayer.utils.windowHeight()
	},
	rpSize: {
		width: radioplayer.utils.windowWidth(),
		height: radioplayer.utils.windowHeight()
	},
	isPlaying: false,
	vjsSkin: 'vjs-tech',
	probablyFiles: [],
	maybeFiles: [],
	flashFiles: [],
	response: null,
	maxAdSize: {
		width: 640,
		height: 480
	},
	maxCompanionSize: {
		width: 700,
		height: 100
	},

	/**
	 * Initialisation for VAST support.
	 *
	 * @method init
	 */
  init: function() {
		this.enabled = vastAds.enabled || false;
    if (!this.enabled) return;

		this.vastTag = vastAds.vastTag || '';
    if (('undefined' === typeof this.vastTag) || ('' === this.vastTag)) {
			if (this.DEBUG) radioplayer.utils.output('[VAST] VAST URL not specified, disabling VAST.');
			return;
		}

		if (this.DEBUG) radioplayer.utils.output('[VAST] Initialising VAST.');

		this.vjsSkin = vastAds.vjsSkin || 'vjs-tech';

		this.getContentAndPlay(this.vastTag);
	},


	/**
	 * checks if the player can play back a given mimetye and codec
	 *
	 * @param mimeType		Mime type to be checked
	 * @param codec				Codec associated with the mime type
	 * @returns String		'probably', 'maybe', 'no'
	 */
	canPlayVideo: function(mimeType, codec) {
		var canPlay = 'no';
		// create temp video element for playback test
		var el = document.createElement('video');

		if ('function' !== typeof el.canPlayType) {
			canPlay = 'no';
		} else {
			if ((null === codec) || ('' === codec) || ('undefined' === typeof codec)) {
				canPlay = el.canPlayType(mimeType);
			} else {
				canPlay = el.canPlayType(mimeType + ';codecs="' + codec + '"');
			}
		}

		el = null;
		if ('' === canPlay) {
			canPlay = 'no';
		}

		if (radioplayer.vast.DEBUG) radioplayer.utils.output('[VAST] Testing video playback capabilities. mimeType: ' + mimeType + ', codec: ' + codec + ' result: ' + canPlay);

		return canPlay;
	},


	/**
	 * Retrieves JS object from vast-client and finds playable advert and companion.
	 * First advert that the browser can play and that is smaller or equal in size to the maximum
	 * permitted ad size (set in 'maxAdSize').
	 * Companion ads will only be displayed if they are smaller or equal in size to the maximum
	 * permitted companion ad size (set in 'maxCompanionSize').
	 */
	getContentAndPlay: function(vastUrl) {
		DMVAST.timeout = this.timeout;
		if (radioplayer.vast.DEBUG) radioplayer.utils.output('[VAST] Retrieving VAST content. Timeout: ' + String(this.timeout / 1000) + ' sec.');

		function getVASTData() {
			var def = $.Deferred();
			if (radioplayer.vast.DEBUG) radioplayer.utils.output('[VAST] Retrieved VAST content');

			var failTimeout = setTimeout(function(){
				def.reject()
			}, 5000)
			DMVAST.client.get(vastUrl, function(response) {
				def.resolve( response );
			});
			return def.promise();
		}

		var VASTPromise = getVASTData();
		VASTPromise.done(function(resp) {
			radioplayer.vast.response = resp;
			if(!resp || !resp.ads) {
				radioplayer.vast.dispose();
				return false;
			}
			var advert = {};

			advert.ad = '';
			advert.adType = '';
			advert.creative = '';
			advert.companion = '';
			advert.companionType = '';
			for (var adIdx = 0; adIdx < radioplayer.vast.response.ads.length; adIdx++) {
				var adv = radioplayer.vast.response.ads[adIdx];
				for (var creaIdx = 0; creaIdx < adv.creatives.length; creaIdx++) {
					var crv = adv.creatives[creaIdx];

					switch (crv.type) {
						case 'linear':
							for (var mfIdx = 0; mfIdx < crv.mediaFiles.length; mfIdx++) {
								var mediaFile = crv.mediaFiles[mfIdx];
								if ((mediaFile.width <= radioplayer.vast.maxAdSize.width) && (mediaFile.height <= radioplayer.vast.maxAdSize.height)) {
									if ('application/x-shockwave-flash' === mediaFile.mimeType) {
										advert.ad = adv;
										advert.mediaFile = mediaFile;
										advert.creative = crv;
										advert.adType = 'flash';
										break;
									} 
									else {
										if (('probably' === radioplayer.vast.canPlayVideo(mediaFile.mimeType, mediaFile.codec)) || ('maybe' === radioplayer.vast.canPlayVideo(mediaFile.mimeType, mediaFile.codec))) {
											advert.ad = adv;
											advert.mediaFile = mediaFile;
											advert.creative = crv;
											advert.adType = 'video';
											break;
										}
									}
								}
							}
						break;

						case 'non-linear' :
							// NOT SUPPORTED
						break;

						case 'companion' :
							for (var cpIdx = 0; cpIdx < crv.variations.length; cpIdx++) {
								var companionAd = crv.variations[cpIdx];

								if ((companionAd.width <= radioplayer.vast.maxCompanionSize.width) && (companionAd.height <= radioplayer.vast.maxCompanionSize.height)) {
									switch(companionAd.type) {
										case 'image/gif':
										case 'image/png':
										case 'image/jpg':
										case 'image/jpeg':
											advert.companion = companionAd;
											advert.companionType = 'image';
										break;

										case 'text/html':
											advert.companion = companionAd;
											advert.companionType = 'html';
										break;

										default:
											advert.companion = companionAd;
											advert.companionType = 'iframe';
										break;
									}
								}
							}
						break;

						default:
						break;
					}
				}
			}

			if ('' !== advert.ad) {
				radioplayer.vast.startPlayer(advert);
				if ('' !== advert.companion) {
					radioplayer.vast.startCompanion(advert);
				}
			} else {
				radioplayer.vast.dispose();
			};
		}).fail(function(){
			radioplayer.vast.dispose('video');
		})
	},


	/**
	 * Creates video player instance with associated event handlers
	 *
	 * @param {object} advert		advert object
	 * @returns video player instance
	 */
	startPlayer: function(advert) {
		var playerHTML = '';
		if ('video' === advert.adType) {
			if (radioplayer.vast.DEBUG) radioplayer.utils.output('[VAST] Creating overlay code for VAST player.')
			playerHTML = '<div class="vast-container" id="vast-container">\
				<div id="vast-video-container">\
					<video id="' + this.videoPlayerId+ '" class="video-js ' + this.vjsSkin + ' vjs-big-play-centered">\
					</video>\
				</div>\
				<div id="vast-companion-container" class="companion-container">\
				</div>\
			</div>';

			radioplayer.services.overlay.vast(playerHTML);
			$('video').on('contextmenu', function(){
				return false;
			});

			this.isPlaying = true;
			var el = document.getElementById(this.videoPlayerId);
			var plInst = null;
			if (radioplayer.consts.is_iOS || radioplayer.consts.is_Android) {
				plInst = videojs(el, {
						preload: 'auto',
						width: null,		// need to set with and height to 'null' in order to prevent
						height: null,		// video.js from applying standard size (300x150)
						controls: false,
						autoplay: true,
						techOrder: ["html5","flash"],
				});
			} 
			else {
				plInst = videojs(el, {
						preload: 'auto',
						width: null,		// need to set with and height to 'null' in order to prevent
						height: null,		// video.js from applying standard size (300x150)
						controls: false,
						autoplay: true,
						techOrder: ["html5","flash"],
				});
			}

			plInst.ads();

	    plInst.vast({
	      url: radioplayer.vast.vastTag,
	      skip: -1,
	      ads: {}
	    });


			plInst.vastTracker = new DMVAST.tracker(advert.ad, advert.creative);

      plInst.on('adend', function() {
      	radioplayer.vast.dispose('video');
    		plInst.vastTracker.complete();
				plInst.vastTracker.stop();
			});

      plInst.on('adclick', function() {
      });

			plInst.src({
				type: advert.mimeType,
				src: advert.mediaFile.fileURL
			});

			window.resizeTo(this.vastSize.width, this.vastSize.height);

			window.setTimeout($.proxy(function() {
				if (((radioplayer.consts.is_iOS || radioplayer.consts.is_Android)) && (plInst.paused())) {
					plInst.bigPlayButton.show();
				}

				plInst.on('play', function() {plInst.bigPlayButton.hide()} );
			}, plInst), 1000);

			if (null !== plInst) {
				// put player in ad mode
				plInst.href = advert.mediaFile.fileURL;
			}

			if (!plInst.vastTracker) {
				// Inform ad server we can't find suitable media file for this ad
				DMVAST.util.track(advert.ad.errorURLTemplates, {ERRORCODE: 403});
			}
		} 
		else if ('flash' === advert.adType) {
			window.resizeTo(this.vastSize.width, this.vastSize.height);

			var horizMargin = (this.vastSize.width - advert.mediaFile.width) / 2;
			playerHTML  =		'<div class="vast-container" id="vast-container">';
			playerHTML +=			'<div class="close-vast-btn-container"><button class="close-vast-btn" id="closeVASTBtn"><span>&times;</span><label class="close-vast-btn-label accessibility-text" for="closeVASTBtn">Close Ad</label></button></div>';
			playerHTML +=			'<div class="vast-flash-container">'
			playerHTML +=			  '<object class="vast-flash-obj" id="vastAdObj" style="width: ' + advert.mediaFile.width + 'px; height: ' + advert.mediaFile.height + 'px; margin: 0 ' + horizMargin + 'px;">';
			playerHTML +=				  '<param name="movie" value="' + advert.mediaFile.fileURL + '" />';
			playerHTML +=				  '<embed class="vast-flash-embed" id="' + this.videoPlayerId + '" src="' + advert.mediaFile.fileURL + '" style="width: ' + advert.mediaFile.width + 'px; height: ' + advert.mediaFile.height + 'px; margin: 0 ' + horizMargin + 'px;" type="application/x-shockwave-flash"></embed>';
			playerHTML +=			  '</object>';
			// playerHTML +=		'<object type="application/x-shockwave-flash" data="' + advert.mediaFile.fileURL + '" width="' + advert.mediaFile.width + '" height="' + advert.mediaFile.height + '"><param name="movie" value="'  + advert.mediaFile.fileURL +  '" /></object>';
			playerHTML +=			'</div>';
			playerHTML +=		'</div>';
			playerHTML +=		'<div id="vast-companion-container" class="companion-container"></div>';
			radioplayer.services.overlay.vast(playerHTML);

			$('#closeVASTBtn').on('click', function(){
				if(radioplayer.vast.closeTimeout) {
					clearTimeout(radioplayer.vast.closeTimeout);
				}
				radioplayer.vast.dispose('flash');
			})
		}
		else {
		}

		// dispose of player instance once video has finished
		if ('undefined' === typeof advert.creative.duration) {
			duration = 30;

			radioplayer.vast.closeTimeout = setTimeout(function() {
				// dispose of player after 30 seconds max
				radioplayer.vast.dispose('flash');
			}, (duration * 1000));
		};			
	},


	/**
	 * starts the companion ad display
	 * @method startCompanion
	 * @param {object} advert		advert object
	 */
	startCompanion: function(advert) {
		var companionInsertionPoint = document.getElementById('vast-companion-container');
		var docElement = document.createElement("div");

		if('image' === advert.companionType) {
			var aElement = document.createElement('a');
			var companionAsset = new Image();
			aElement.setAttribute('target', '_blank');
			companionAsset.src = advert.companion.staticResource;
			companionAsset.width = advert.companion.width;
			companionAsset.height = advert.companion.height;
			aElement.href = advert.companion.companionClickThroughURLTemplate;
			aElement.appendChild(companionAsset);
			docElement.appendChild(aElement);
			companionInsertionPoint.appendChild(docElement);

		} else if ('text' === advert.companionType) {
			docElement.innerHTML = advert.companion.htmlResource;
			companionInsertionPoint.appendChild(docElement);
		} else {
			if (advert.companion.iframeResource) {
				var aElement = document.createElement('iframe');
				aElement.src = advert.companion.staticResource;
				aElement.width = advert.companion.width;
				aElement.height = advert.companion.height;
				docElement.appendChild(aElement);
				companionInsertionPoint.appendChild(docElement);
			}
		}
	},


	/**
	 * disposes of video player instance, sizes window back to original size, hides overlay
	 * and performs general housekeeping functions
	 * @method dispose
	 * @param {String} type 	type of player to be disposed ('video' or 'flash')
	 */
	dispose: function(type) {
		if ('video' === type) {
			if (radioplayer.vast.DEBUG) radioplayer.utils.output('[VAST] Disposing of video player instance.');
			try {
				var plInst = videojs(this.videoPlayerId);
				if ('undefined' !== typeof plInst) {
					radioplayer.overlay.hide();

					plInst.pause();
					plInst.dispose();
				}
			}
			catch(err) {
			}

			radioplayer.utils.resizeViewPort(380, 665);
			radioplayer.services.overlay.hide();
		} 
		else if ('flash' === type) {
			if (radioplayer.vast.DEBUG) radioplayer.utils.output('[VAST] Disposing of flash player instance.');
			$('#vast-container').remove();

			radioplayer.utils.resizeViewPort(380, 665);

			radioplayer.services.overlay.hide();
		}

		vastAds.shownVideo = true;

		/// We can now start the stream
		radioplayer.emp.init(window.audioArray, window.audioLive, window.bufferTime);
		radioplayer.emp.dataReady();

		this.isPlaying  = false;
	}
}
