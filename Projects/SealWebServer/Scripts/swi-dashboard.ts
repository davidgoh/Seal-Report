﻿/// <reference path="typings/jquery/jquery.d.ts" />
/// <reference path="typings/bootstrap/index.d.ts" />
/// <reference path="typings/jstree/jstree.d.ts" />
/// <reference path="typings/main.d.ts" />

var _da: SWIDashboard;
var _dashboardEditor: DashboardEditorInterface;
var hasEditor: boolean;

//Default units
var WidgetWidthUnit = 200;
var WidgetHeightUnit = 140;

declare var Muuri: any;
declare function nvd3UpdateCharts();
declare function getTopLeft(item : any);

//Serialize Muuri order
function serializeLayout(grid) {
    var itemIds = grid.getItems().map(function (item) {
        return item.getElement().getAttribute('id');
    });
    return JSON.stringify(itemIds);
}

function loadLayout(grid, serializedLayout) {
    var layout = JSON.parse(serializedLayout);
    var currentItems = grid.getItems();
    var currentItemIds = currentItems.map(function (item) {
        return item.getElement().getAttribute('id')
    });
    var newItems = [];
    var itemId;
    var itemIndex;

    for (var i = 0; i < layout.length; i++) {
        itemId = layout[i];
        itemIndex = currentItemIds.indexOf(itemId);
        if (itemIndex > -1) {
            newItems.push(currentItems[itemIndex])
        }
    }

    if (layout.length == newItems.length) grid.sort(newItems, { layout: 'instant' });
    else grid.layout(true);
}

class SWIDashboard implements DashboardInterface {
    private _dashboards = [];
    private _gridOrders = [];
    private _grids = [];
    public _gridsById = [];
    public _dashboard;
    public _lastGUID;
    public _dragType;
    public _dragData;


    public reorderItems(init : boolean) {
        if (!_da._dashboard) return;

        if (init) _da._gridsById = []; //Force rebuild of grids
        _da._grids = [];
        $('.grid' + _da._dashboard.GUID).each(function (index, element) {
            var gridId = $(this).attr("id");
            var grid = _da._gridsById[gridId];
            if (!grid) {
                grid = new Muuri('#' + gridId, {
                    dragEnabled: _da._dashboard.Editable,
                    layoutOnInit: false,
                    dragStartPredicate: {
                        distance: 10,
                        delay: 80
                    },
                    dragSort: function () {
                        return _da._grids;
                    }
                });
                _da._gridsById[gridId] = grid;
            }
            _da._grids.push(grid);

            var gridOrder = _da._gridOrders[gridId];
            if (gridOrder) {
                loadLayout(grid, gridOrder);
            } else {
                grid.layout(true);
            }

            grid.on('dragReleaseEnd', function (widgetItem) {
                var itemId = $(widgetItem._element).attr("id");
                var destGroup = $(widgetItem._element).parent().attr("group-name");
                var hasChanged = false;
                var allSortIds = [];
                $('.grid' + _da._dashboard.GUID).each(function (index, element) {
                    var gridId = $(this).attr("id");
                    var initialSort = _da._gridOrders[gridId];
                    var sortIds = [];
                    var grid = _da._gridsById[gridId];
                    var items = grid.getItems();
                    for (var i = 0; i < items.length; i++) {
                        var item = items[i];
                        var itemId = $(item._element).attr("id");
                        sortIds.push(itemId);
                        allSortIds.push(itemId);
                    }
                    _da._gridOrders[gridId] = serializeLayout(grid);

                    if (JSON.stringify(sortIds) != initialSort) hasChanged = true;
                });
                
                if (hasChanged) {
                    _gateway.SaveDashboardItemsOrder(_da._dashboard.GUID, allSortIds, itemId, destGroup, null);
                }
            });
        });
    }

    private enableControls() {
        var spinnerHidden = !$(".spinner-menu").is(":visible")
        SWIUtil.EnableButton($("#dashboard-add-widget"), _da._dashboard && _da._dashboard.Editable && spinnerHidden);
        SWIUtil.EnableButton($("#dashboards-nav-item"), spinnerHidden);
    }

    private handleDashboardResult(data: any) {
        var panel = $("#" + data.itemguid);
        var panelHeader = panel.children(".panel-heading");

        //Set description and hyper link
        var nameLink: JQuery = panelHeader.find("a");
        nameLink.attr("title", data.description);
        if (data.path) {
            nameLink.attr("path", data.path);
            nameLink.unbind('click').on("click", function (e) {
                _gateway.ExecuteReport($(e.currentTarget).attr("path"), false, null, null);
            });
        }

        //Set content
        var panelBody = panel.children(".panel-body");
        panelBody.empty();

        panelBody.html(data.content);

        //Dynamic properties
        if (data.dynamic) {
            var newIcon = $(data.content).children("#new-widget-icon").val();
            if (newIcon) {
                var spanIcon = panelHeader.children(".glyphicon");
                spanIcon.removeClass();
                spanIcon.addClass("glyphicon glyphicon-" + newIcon);
            }
            var newColor = $(data.content).children("#new-widget-color").val();
            if (newColor) {
                panel.removeClass();
                panel.addClass("item panel panel-" + newColor);
            }
            var newName = $(data.content).children("#new-widget-name").val();
            if (newName) {
                panelHeader.find("a").text(" " + newName);
            }
        }
        panelHeader.children(".fa-spinner").hide();

        //Refresh button
        $("#rb" + data.itemguid).attr("title", data.lastexec);

    }

    public initDashboardItems(guid: string) {
        var dashboard = _da._dashboards[guid];
        if (!dashboard) return;

        $("[did='" + guid + "']").children(".spinner-menu").show();
        SWIUtil.EnableButton($("#dashboard-add-widget"), false);
        SWIUtil.EnableButton($("#dashboards-nav-item"), false);

        //re-init order
        $('.grid' + guid).each(function (index, element) {
            var gridId = $(this).attr("id");
            _da._gridOrders[gridId] = null;
            _da._gridsById[gridId] = null;
        });

        _gateway.GetDashboardItems(guid, function (data) {
            var content = $("#" + guid);
            content.empty();

            $("[did='" + guid + "']").children(".spinner-menu").hide();
            _da.enableControls();

            var currentGroup = "";
            var grid: JQuery = null;
            for (var i = 0; i < data.length; i++) {
                var item = data[i];

                if (currentGroup != item.GroupName || !grid) {
                    content.append($("<hr style='margin:5px 2px'>"));
                    if (item.GroupName != "") {
                        //Group name 
                        var groupSpan = $("<span for='gn" + item.GUID + "'>").text(item.GroupName);
                        var groupInput = $("<input type='text' id='gn" + item.GUID + "' style='width:250px;' hidden>");
                        if (_da._dashboards[guid].Editable) {
                            //Edit group name
                            groupSpan.click(function () {
                                "use strict";
                                $(this).hide();
                                $('#' + $(this).attr('for'))
                                    .val($(this).text())
                                    .toggleClass("form-control")
                                    .show().focus();
                            });

                            groupInput.blur(function () {
                                "use strict";
                                $(this)
                                    .hide()
                                    .toggleClass("form-control");
                                var myid = (this).id;
                                var span = $('span[for=' + myid + ']');
                                if (span.text() != $(this).val()) {
                                    _gateway.UpdateDashboardItemsGroupName(guid, span.text(), $(this).val(), function (data) {
                                        _da.initDashboardItems(guid);
                                    });
                                }
                                span.text($(this).val()).show();
                            });
                        }

                        var groupDrag = $("<h4 style='margin:0px 5px'>").append(groupSpan);
                        groupDrag.attr("group-order", item.GroupOrder)
                        content.append(groupDrag);
                        content.append(groupInput);

                        if (_da._dashboards[guid].Editable) {
                            //Drag for group name
                            groupDrag.on("dragstart", function (e) {
                                _da._dragType = "group";
                                _da._dragData = $(this).attr("group-order");
                            });

                            groupDrag.prop("draggable", "true");
                        }
                    }

                    //Add current grid
                    grid = $("<div class='grid grid" + dashboard.GUID + "'>");
                    grid.attr("id", "g" + dashboard.GUID + "-" + item.GroupOrder);
                    grid.attr("group-order", item.GroupOrder);
                    grid.attr("group-name", item.GroupName);
                    _da._gridsById[grid.attr("id")] = null; 
                    content.append(grid);
                    currentGroup = item.GroupName;

                    if (_da._dashboards[guid].Editable) {
                        //Drop for group name
                        grid.on("dragover", function (e) {
                            if (_da._dragType == "group") e.preventDefault();
                        });

                        grid.on("drop", function (e) {
                            var sourceOrder = _da._dragData;
                            var destinationOrder = parseInt($(this).attr("group-order"));
                            _gateway.SwapDashboardGroupOrder(_da._lastGUID, sourceOrder, destinationOrder, function (data) {
                                _da.initDashboardItems(_da._lastGUID);
                            });
                        });
                    }
                }
                var panel = $("<div class='item panel panel-" + item.Color + "' id='" + item.GUID + "'>");

                var panelHeader = $("<div class='panel-heading text-left' style='padding-right:2px;'>");
                panel.append(panelHeader);
                panelHeader.append($("<span class='glyphicon glyphicon-" + item.Icon + "'>"));

                var nameLink = $("<a>)").text(" " + item.Name);
                var panelName = $("<h3 class='panel-title' style='display:inline'>").append(nameLink);

                panelHeader.append(panelName);
                panelHeader.append($("<i class='fa fa-spinner fa-spin fa-sm fa-fw'></i>"));

                var refreshButton = $("<button class='btn btn-sm btn-info' type='button' style='margin-left:2px;margin-right:0px;padding:0px 6px;'><span class='glyphicon glyphicon-refresh'></span></button>");
                var panelButtons = $("<div style='display:none;float:right;'>");

                refreshButton.attr("id", "rb" + item.GUID);
                refreshButton.attr("title", "Refresh widget data");

                panelButtons.append(refreshButton);
                if (hasEditor && dashboard.Editable) {
                    var buttons = _dashboardEditor.getEditButtons();
                    for (var j = 0; j < buttons.length; j++) {
                        panelButtons.append(buttons[j]);
                    }
                }

                panelHeader.append(panelButtons);

                var panelBody = $("<div class='panel-body text-center'>");
                panel.append(panelBody);

                panelBody.append($("<i class='fa fa-spinner fa-spin fa-2x fa-fw'></i>"));
                panelBody.append($("<h4 style='display:inline'></h4>").text(SWIUtil.tr("Processing...")));
                _gateway.GetDashboardResult(guid, item.GUID, false, function (data) {
                    _da.handleDashboardResult(data);
                });

                var guid2 = dashboard.GUID;

                //Size
                panel.width(Math.floor(item.Width * WidgetWidthUnit));
                panel.height(Math.floor(item.Height * WidgetHeightUnit));

                //Panel buttons
                panelHeader
                    .mouseenter(function (e) {
                        var panelHeading = $(this).closest('.panel-heading');
                        if (!panelHeading.children(".fa-spinner").is(":visible")) {
                            var tl = getTopLeft($(this)[0]);
                            var buttons = $(this).children("div");
                            buttons.css("position", "absolute");
                            buttons.css("left", tl[0] + $(this).width() - buttons.width() + 15);
                            buttons.css("top", tl[1] + 10);
                            buttons.show();
                        }

                    })
                    .mouseleave(function () {
                        $(this).children("div").hide();
                    });

                //Refresh item
                refreshButton.unbind('click').on("click", function (e) {
                    var itemGuid = $(this).closest('.panel').attr('id');

                    var panelHeading = $(this).closest('.panel-heading');
                    panelHeading.children(".fa-spinner").show();

                    _gateway.GetDashboardResult(guid2, itemGuid, true, function (data) {
                        _da.handleDashboardResult(data);
                    });
                });

                grid.append(panel);
            } //for

            if (_da._dashboard && guid == _da._dashboard.GUID) _da.reorderItems(false);
        });
    }

    public init() {
        _da = this;
        _da._dashboard = null;
        if (!_da._lastGUID) _da._lastGUID = _main._profile.dashboard;
        if (_dashboardEditor) _dashboardEditor.init();

        $waitDialog.modal();

        _gateway.GetUserDashboards(function (data) {
            _da._dashboards = [];
            $("#menu-dashboard").empty();
            $("#content-dashboard").empty();

            //Init array
            for (var i = 0; i < data.length; i++) {
                var dashboard = data[i];
                _da._dashboards[dashboard.GUID] = dashboard;
            }

            //Set current dashboard
            _da._dashboard = _da._dashboards[_da._lastGUID];
            if (!_da._dashboard && data.length > 0) {
                _da._lastGUID = data[0].GUID;
                _da._dashboard = data[0];
            }
            //Build menu
            for (var i = 0; i < data.length; i++) {
                var dashboard = data[i];

                var menu = $("<a data-toggle='pill' href='#" + dashboard.GUID + "' did='" + dashboard.GUID + "'>");
                if (dashboard.IsPersonal) menu.addClass("dashboard-personal");
                menu.text(dashboard.Name);
                var li = $("<li>");

                //Drag and drop for menu
                li.on("dragstart", function (e) {
                    _da._lastGUID = $(this).children("a").attr("did");
                    _da._dragType = "menu";
                });
                li.prop("draggable", "true");
                li.on("dragover", function (e) {
                    if (_da._dragType == "menu") e.preventDefault();
                });
                li.on("drop", function (e) {
                    _da._dragType = "";
                    var sourceid = _da._dashboard.GUID;
                    var did = $(this).children("a").attr("did");
                    _gateway.SwapDashboardOrder(_da._lastGUID, did, function (data) {
                        _da.init();
                    });
                });

                //Spinner menu
                menu.append($("<i class='fa fa-spinner fa-spin fa-1x fa-fw spinner-menu'></i>"));

                var isActive = (dashboard.GUID == _da._lastGUID);
                if (isActive) li.addClass("active");
                $("#menu-dashboard").append(li.append(menu));

                //Click on a dashboard pill
                menu.unbind('click').click(function (e) {
                    var id = $(this).attr("did");
                    _da._lastGUID = id;
                    _da._dashboard = _da._dashboards[id];
                    _da.enableControls();
                    _gateway.SetLastDashboard(_da._lastGUID, null);
                    _main._profile.dashboard = _da._lastGUID;

                    setTimeout(function () {
                        nvd3UpdateCharts();
                        $($.fn.dataTable.tables(true)).DataTable().columns.adjust().responsive.recalc();
                        _da.reorderItems(true);
                    }, 200);
                });

                var content = $("<div id='" + dashboard.GUID + "' class='tab-pane fade'>");
                $("#content-dashboard").append(content);

                if (isActive) content.addClass("in active");
            }

            //Init active first
            if (_da._lastGUID) _da.initDashboardItems(_da._lastGUID);
            for (var i = 0; i < data.length; i++) {
                if (!_da._lastGUID || data[i].GUID != _da._lastGUID) _da.initDashboardItems(data[i].GUID);
            }

            //Manage
            $("#dashboards-nav-item").unbind('click').on("click", function (e) {
                _gateway.GetDashboards(function (data) {
                    var select = $("#dashboard-user");
                    select.unbind("change").selectpicker("destroy").empty();
                    for (var j = 0; j < data.length; j++) {
                        var pubDashboard = data[j];
                        select.append(SWIUtil.GetOption(pubDashboard.GUID, pubDashboard.FullName, ""));
                    }
                    select.selectpicker({
                        "liveSearch": true
                    });

                    //Add
                    SWIUtil.ShowHideControl($("#dashboard-add").parent(), data.length > 0);
                    $("#dashboard-add").unbind('click').on("click", function (e) {
                        if (!$("#dashboard-user").val()) return;
                        $("#dashboard-dialog").modal('hide');
                        _gateway.AddDashboard($("#dashboard-user").val(), function (data) {
                            _da._lastGUID = null;
                            _da.init();
                            SWIUtil.ShowMessage("alert-success", SWIUtil.tr("The dashboards has been added to your view"), 5000);
                        });
                    });

                    //Remove
                    SWIUtil.ShowHideControl($("#dashboard-remove").parent(), _da._dashboard);
                    if (_da._dashboard) {
                        $("#dashboard-remove")
                            .text("'" + _da._dashboard.FullName + "' : " + SWIUtil.tr("Remove the dashboard from your view"))
                            .unbind('click').on("click", function (e) {
                                $("#dashboard-dialog").modal('hide');
                                _gateway.RemoveDashboard(_da._dashboard.GUID, function (data) {
                                    _da._lastGUID = null;
                                    _da.init();
                                    SWIUtil.ShowMessage("alert-success", SWIUtil.tr("The dashboard has been removed from your view"), 5000);
                                });
                            });
                    }

                    if (hasEditor) {
                        _dashboardEditor.initDashboardMenu();
                    }

                    $("#dashboard-dialog").modal();
                });
            });

            if (hasEditor) {
                _dashboardEditor.initMenu();
            }

            _da.enableControls();
        });

        _da.enableControls();
        $waitDialog.modal('hide');
    }
}