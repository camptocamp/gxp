/**
 * @requires plugins/Tool.js
 */

Ext.namespace("gxp.plugins");

gxp.plugins.FeatureManager = Ext.extend(gxp.plugins.Tool, {
    
    /** api: ptype = gx_wmsgetfeatureinfo */
    ptype: "gx_featuremanager",
    
    /** api: config[maxFeatures]
     *  ``Number`` Default is 100
     */
    maxFeatures: 100,

    /** api: config[autoSetLayer]
     *  ``Boolean`` Listen to the viewer's layerselectionchange event to
     *  automatically set the layer? Default is true.
     */
    autoSetLayer: true,

    /** api: config[autoLoadFeatures]
     *  ``Boolean`` Automatically load features after a new layer has been set?
     *  Default is false.
     */
    autoLoadFeatures: false,
    
    /** api: config[symbolizer]
     *  ``Object`` An object with "Point", "Line" and "Polygon" properties,
     *  each with a valid symbolizer object for OpenLayers. Will be used to
     *  render features.
     */
    
    /** api: property[layerRecord]
     *  ``GeoExt.data.LayerRecord`` The currently selected layer for this
     *  FeatureManager
     */
    layerRecord: null,
    
    /** api: property[featureStore]
     *  :class:`gxp.data.WFSFeatureStore` The FeatureStore that this tool
     *  manages.
     */
    featureStore: null,
    
    /** api: property[featureLayer]
     *  ``OpenLayers.Layer.Vector`` The layer associated with this tool's
     *  featureStore.
     */
    featureLayer: null,
    
    /** api: property[schema]
     *  ``GeoExt.data.AttributeStore`` or false if the ``featureLayer`` has no
     *   associated WFS FeatureType, or null if no layer is currently selected.
     */
    schema: null,
    
    /** api: property[geometryType]
     *  ``String`` The geometry type of the featureLayer
     */
    geometryType: null,
    
    /** private: property[toolsShowingLayer]
     *  ``Object`` keyed by tool id - tools that currently need to show the
     *  layer. Each entry holds a String, which is either "default" or
     *  "invisible". Selected features will always be shown, and tools setting
     *  the style to "default" take precedence over tools that set it to
     *  "invisible".
     */
    toolsShowingLayer: null,
    
    /** private: property[style]
     *  ``Object`` with an "all" and a "selected" property, each holding an
     *  ``OpenLayers.Style``
     */
    style: null,
    
    /** private: property[invisibleStyle]
     */
    invisibleStyle: null,
    
    /** api: method[init]
     */
    init: function(target) {
        gxp.plugins.FeatureEditor.superclass.init.apply(this, arguments);
        
        this.addEvents(
            /** api: event[beforequery]
             *  Fired before a WFS GetFeature request is issued. This event
             *  can be used to abort the loadFeatures method before any action
             *  is performed, by having a listener return false.
             *
             *  Listener arguments:
             *  * tool   - :class:`gxp.plugins.FeatureManager` this tool
             *  * filter - ``OpenLayers.Filter`` the filter argument passed to
             *    the loadFeatures method
             *  * callback - ``Function`` the callback argument passed to the
             *    loadFeatures method
             *  * scope - ``Object`` the scope argument passed to the
             *    loadFeatures method
             */
            "beforequery",
            
            /** api: event[query]
             *  Fired after a WFS GetFeature query, when the results are
             *  available.
             *
             *  Listener arguments:
             *  * tool  - :class:`gxp.plugins.FeatureManager` this tool
             *  * store - :class:`gxp.data.WFSFeatureStore
             */
            "query",
            
            /** api: event[beforelayerchange]
             *  Fired before a layer change results in destruction of the
             *  current featureStore, and creation of a new one. This event
             *  can be used to abort the setLayer method before any action is
             *  performed, by having a listener return false.
             *
             *  Listener arguments:
             *  * tool  - :class:`gxp.plugins.FeatureManager` this tool
             *  * layer - ``GeoExt.data.LayerRecord`` the layerRecord argument
             *    passed to the setLayer method
             */
            "beforelayerchange",
            
            /** api: event[layerchange]
             *  Fired after a layer change, as soon as the layer's schema is
             *  available.
             *
             *  Listener arguments:
             *  * tool   - :class:`gxp.plugins.FeatureManager` this tool
             *  * layer  - ``GeoExt.data.LayerRecord`` the new layer
             *  * schema - ``GeoExt.data.AttributeStore`` or false if the
             *    layer has no associated WFS FeatureType, or null if no layer
             *    is currently selected.
             */
            "layerchange"
        );
        
        this.toolsShowingLayer = {};
        
        this.style = {
            "all": new OpenLayers.Style(null, {
                rules: [new OpenLayers.Rule({
                    symbolizer: this.initialConfig.symbolizer || {
                        "Point": {
                            pointRadius: 4,
                            graphicName: "square",
                            fillColor: "white",
                            fillOpacity: 1,
                            strokeWidth: 1,
                            strokeOpacity: 1,
                            strokeColor: "#333333"
                        },
                        "Line": {
                            strokeWidth: 4,
                            strokeOpacity: 1,
                            strokeColor: "#ff9933"
                        },
                        "Polygon": {
                            strokeWidth: 2,
                            strokeOpacity: 1,
                            strokeColor: "#ff6633",
                            fillColor: "white",
                            fillOpacity: 0.3
                        }
                    }
                })]
            }),
            "selected": new OpenLayers.Style(null, {
                rules: [new OpenLayers.Rule({symbolizer: {display: "none"}})]
            })
        };
        
        this.featureLayer = new OpenLayers.Layer.Vector(Ext.id(), {
            displayInLayerSwitcher: false,
            styleMap: new OpenLayers.StyleMap({
                "select": OpenLayers.Util.extend({display: ""},
                    OpenLayers.Feature.Vector.style["select"]),
                "vertex": this.style["all"]
            }, {extendDefault: false})    
        });

        this.autoSetLayer && this.target.on("layerselectionchange",
            this.setLayer, this
        );
        this.on("layerchange", function(mgr, layer, schema) {
            this.schema = schema;
        }, this);
    },
    
    /** api: method[setLayer]
     *  :arg layerRecord: ``GeoExt.data.LayerRecord``
     *
     *  Sets the layer for this tool
     */
    setLayer: function(tool, layerRecord) {
        if (this.fireEvent("beforelayerchange", this, layerRecord) !== false) {
            if (layerRecord !== this.layerRecord) {
                this.clearFeatureStore();
                this.layerRecord = layerRecord;
                if (layerRecord) {
                    this.autoLoadFeatures === true ?
                        this.loadFeatures() :
                        this.setFeatureStore();
                } else {
                    this.fireEvent("layerchange", this, null);
                }
            }
        }
    },
    
    /** api: method[showLayer]
     *  :arg id: ``String`` id of a tool that needs to show this tool's
     *      featureLayer.
     *  :arg display: ``String`` "all" or "selected". Optional, default is
     *      "all"
     */
    showLayer: function(id, display) {
        style = display || "all";
        this.toolsShowingLayer[id] = style;
        this.setLayerDisplay();
    },
    
    /** api: method[hideLayer]
     *  :arg id: ``String`` id of a tool that no longer needs to show this
     *      tool's featureLayer. The layer will be hidden if no more tools need
     *      to show it.
     */
    hideLayer: function(id) {
        delete this.toolsShowingLayer[id];
        this.setLayerDisplay();
    },
    
    /** private: mathod[setLayerDisplay]
     *  If ``toolsShowingLayer`` has entries, the layer will be added to the
     *  map, otherwise it will be removed. Tools can choose whether they want
     *  to display all features (display == "all") or only selected features
     *  (display == "selected"). If there are both tools that want to show all
     *  features and selected features, all features will be shown.
     */
    setLayerDisplay: function() {
        var show = false;
        for (var i in this.toolsShowingLayer) {
            if (show != "all") {
                show = this.toolsShowingLayer[i];
            }
        }
        if (show) {
            var style = this.style[show];
            if (style !== this.featureLayer.styleMap.styles["default"]) {
                this.featureLayer.styleMap.styles["default"] = style;
                this.featureLayer.redraw();
            }
            this.target.mapPanel.map.addLayer(this.featureLayer);
        } else if (this.featureLayer.map) {
            this.target.mapPanel.map.removeLayer(this.featureLayer);
        }
    },
    
    /** api: method[loadFeatures]
     *  :arg filter: ``OpenLayers.Filter`` Optional filter for the GetFeature
     *      request.
     *  :arg callback: ``Function`` Optional callback to call when the
     *      features are loaded. This function will be called with the array
     *      of the laoded features (``OpenLayers.Feature.Vector``) as argument.
     *  :arg scope: ``Object`` Optional scope for the callback function.
     */
    loadFeatures: function(filter, callback, scope) {
        if (this.fireEvent("beforequery", this, filter, callback, scope) !== false) {
            callback && this.featureLayer.events.register(
                "featuresadded", this, function(evt) {
                    if (this._query) {
                        delete this._query;
                        this.featureLayer.events.unregister(
                            "featuresadded", this, arguments.callee
                        );
                        callback.call(scope, evt.features);
                    }
                }
            );
            this._query = true;
            if (!this.featureStore) {
                this.setFeatureStore(filter, true);
            } else {
                this.featureStore.setOgcFilter(filter);
                this.featureStore.load();
            };
        }
    },
    
    /** private: method[setFeatureStore]
     *  :arg filter: ``OpenLayers.Filter``
     *  :arg autoLoad: ``Boolean``
     */
    setFeatureStore: function(filter, autoLoad) {
        var rec = this.layerRecord;
        var source = this.target.getSource(rec);
        if (source && source instanceof gxp.plugins.WMSSource) {
            source.getSchema(rec, function(s) {
                if (s === false) {
                    this.clearFeatureStore();
                } else {
                    var fields = [], match, geometryName;
                    s.each(function(r) {
                        // TODO: To be more generic, we would look for GeometryPropertyType as well.
                        match = /gml:((Multi)?(Point|Line|Polygon|Curve|Surface)).*/.exec(r.get("type"));
                        if (match) {
                            geometryName = r.get("name");
                            this.geometryType = match[1];
                        } else {
                            fields.push({
                                name: r.get("name"),
                                type: ({
                                    "xsd:boolean": "boolean",
                                    "xsd:int": "int",
                                    "xsd:integer": "int",
                                    "xsd:short": "int",
                                    "xsd:long": "int",
                                    "xsd:date": "date",
                                    "xsd:string": "string",
                                    "xsd:float": "float",
                                    "xsd:double": "float"
                                })[r.get("type")]
                            });
                        }
                    }, this);
                    this.featureStore = new gxp.data.WFSFeatureStore({
                        fields: fields,
                        srsName: this.target.mapPanel.map.getProjection(),
                        url: s.url,
                        featureType: s.reader.raw.featureTypes[0].typeName,
                        featureNS: s.reader.raw.targetNamespace,
                        geometryName: geometryName,
                        maxFeatures: this.maxFeatures,
                        layer: this.featureLayer,
                        ogcFilter: filter,
                        autoLoad: autoLoad,
                        autoSave: false,
                        listeners: {
                            "write": function() {
                                rec.getLayer().redraw(true);
                            },
                            "load": function() {
                                this.fireEvent("query", this, this.featureStore);
                            },
                            scope: this
                        }
                    });
                }
                this.fireEvent("layerchange", this, rec, s);
                }, this
            );
        } else {
            this.clearFeatureStore();
            this.fireEvent("layerchange", this, rec, false);
        }        
    },
    
    /** private: method[clearFeatureStore]
     */
    clearFeatureStore: function() {
        if (this.featureStore) {
            //TODO remove when http://trac.geoext.org/ticket/367 is resolved
            this.featureStore.removeAll();
            this.featureStore.unbind();
            // end remove
            this.featureStore.destroy();
            this.featureStore = null;
            this.geometryType = null;
        }
    }

});

Ext.preg(gxp.plugins.FeatureManager.prototype.ptype, gxp.plugins.FeatureManager);