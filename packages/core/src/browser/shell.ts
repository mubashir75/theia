/*
 * Copyright (C) 2017 TypeFox and others.
 *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Copyright (c) Jupyter Development Team and others
 * Distributed under the terms of the Modified BSD License.
*/

import { injectable, inject, optional } from 'inversify';
import { ArrayExt, each, find, toArray } from "@phosphor/algorithm";
import { Signal } from "@phosphor/signaling";
import {
    BoxLayout,
    BoxPanel,
    DockLayout,
    DockPanel,
    FocusTracker,
    Layout,
    Panel,
    SplitLayout,
    SplitPanel,
    StackedPanel,
    TabBar,
    Title,
    Widget
} from "@phosphor/widgets";
import { VirtualElement, h } from '@phosphor/virtualdom';
import { MenuPath } from "../common";
import { Saveable } from "./saveable";
import { ContextMenuRenderer } from "./context-menu-renderer";
import { StatusBarImpl, StatusBarLayoutData } from "./status-bar/status-bar";

export const ApplicationShellOptions = Symbol("ApplicationShellOptions");

/**
 * The class name added to AppShell instances.
 */
const APPLICATION_SHELL_CLASS = 'theia-ApplicationShell';

/**
 * The class name added to side bar instances.
 */
const SIDEBAR_CLASS = 'theia-SideBar';

/**
 * The class name added to the current widget's title.
 */
const CURRENT_CLASS = 'theia-mod-current';

/**
 * The class name added to the active widget's title.
 */
const ACTIVE_CLASS = 'theia-mod-active';

/**
 * The class name added to the tab bar in a dock panel.
 */
const DOCK_PANEL_TAB_BAR_CLASS = 'p-DockPanel-tabBar';

export interface LayoutData {
    mainArea?: DockLayoutData;
    leftBar?: SideBarData;
    rightBar?: SideBarData;
    bottomBar?: SideBarData;
    statusBar?: StatusBarLayoutData;
}

export interface SideBarData {
    activeWidgets?: Widget[];
    widgets?: Widget[];
}

export interface DockLayoutData extends DockPanel.ILayoutConfig {
    activeWidgets?: Widget[]
}

export const MAINAREA_TABBAR_CONTEXT_MENU: MenuPath = ['mainarea-tabbar-context-menu'];

export const DockPanelTabBarRendererFactory = Symbol('DockPanelTabBarRendererFactory');

@injectable()
export class DockPanelTabBarRenderer implements TabBar.IRenderer<any> {
    readonly closeIconSelector = TabBar.defaultRenderer.closeIconSelector;

    protected _tabBar: TabBar<Widget> | undefined = undefined;
    constructor( @inject(ContextMenuRenderer) protected readonly contextMenuRenderer: ContextMenuRenderer) { }

    renderTab(data: TabBar.IRenderData<any>): VirtualElement {
        const title = data.title;
        const key = TabBar.defaultRenderer.createTabKey(data);
        const style = TabBar.defaultRenderer.createTabStyle(data);
        const className = TabBar.defaultRenderer.createTabClass(data);
        const dataset = TabBar.defaultRenderer.createTabDataset(data);
        return (
            h.li({
                key, className, title: title.caption, style, dataset,
                oncontextmenu: event => this.handleContextMenuEvent(event, title)
            },
                TabBar.defaultRenderer.renderIcon(data),
                TabBar.defaultRenderer.renderLabel(data),
                TabBar.defaultRenderer.renderCloseIcon(data)
            )
        );
    }

    set tabBar(tabBar: TabBar<Widget>) {
        this._tabBar = tabBar;
    }

    handleContextMenuEvent(event: MouseEvent, title: Title<Widget>) {
        event.stopPropagation();
        event.preventDefault();

        if (this._tabBar !== undefined) {
            this._tabBar.currentTitle = title;
            if (title.owner !== null) {
                title.owner.activate();
            }
        }

        this.contextMenuRenderer.render(MAINAREA_TABBAR_CONTEXT_MENU, event);
    }
}

@injectable()
export class DockPanelRenderer implements DockLayout.IRenderer {

    constructor( @inject(DockPanelTabBarRendererFactory) protected readonly tabBarRendererFactory: () => DockPanelTabBarRenderer) {
    }

    createTabBar(): TabBar<Widget> {
        const renderer = this.tabBarRendererFactory();
        const bar = new TabBar<Widget>({ renderer });
        bar.addClass(DOCK_PANEL_TAB_BAR_CLASS);
        renderer.tabBar = bar;
        return bar;
    }

    createHandle(): HTMLDivElement {
        return DockPanel.defaultRenderer.createHandle();
    }
}

/**
 * The application shell.
 */
@injectable()
export class ApplicationShell extends Widget {

    protected mainPanel: DockPanel;
    protected topPanel: Panel;
    protected leftPanelHandler: SideBarHandler;
    protected rightPanelHandler: SideBarHandler;
    protected bottomPanelHandler: SideBarHandler;

    private readonly tracker = new FocusTracker<Widget>();

    readonly currentChanged = new Signal<this, ApplicationShell.IChangedArgs>(this);
    readonly activeChanged = new Signal<this, ApplicationShell.IChangedArgs>(this);

    /**
     * Construct a new application shell.
     */
    constructor(
        @inject(DockPanelRenderer) dockPanelRenderer: DockPanelRenderer,
        @inject(StatusBarImpl) protected readonly statusBar: StatusBarImpl,
        @inject(ApplicationShellOptions) @optional() options?: Widget.IOptions | undefined
    ) {
        super(options);
        this.addClass(APPLICATION_SHELL_CLASS);
        this.id = 'main';

        this.topPanel = this.createTopPanel();
        this.mainPanel = this.createMainPanel(dockPanelRenderer);
        this.leftPanelHandler = this.createSideBarHandler('left');
        this.rightPanelHandler = this.createSideBarHandler('right');
        this.bottomPanelHandler = this.createSideBarHandler('bottom');
        this.layout = this.createLayout();

        this.tracker.currentChanged.connect(this.onCurrentChanged, this);
        this.tracker.activeChanged.connect(this.onActiveChanged, this);
    }

    /**
     * Create the top panel, which is used to hold the main menu.
     */
    protected createTopPanel(): Panel {
        const topPanel = new Panel();
        topPanel.id = 'theia-top-panel';
        return topPanel;
    }

    /**
     * Create the dock panel, which holds the main area for widgets organized with tabs.
     */
    protected createMainPanel(dockPanelRenderer: DockPanelRenderer): DockPanel {
        const dockPanel = new DockPanel({ renderer: dockPanelRenderer });
        dockPanel.id = 'theia-main-dock-panel';
        dockPanel.spacing = 0;
        return dockPanel;
    }

    /**
     * Create a handler for a side bar with corresponding panel for holding widgets.
     */
    protected createSideBarHandler(side: ApplicationShell.Area): SideBarHandler {
        const handler = new SideBarHandler(side);
        handler.sideBar.addClass(SIDEBAR_CLASS);
        handler.sideBar.addClass('theia-mod-' + side);
        handler.stackedPanel.id = 'theia-' + side + '-stack';
        return handler;
    }

    /**
     * Create a panel that arranges a side bar around the given main area.
     */
    protected createSideBarLayout(side: ApplicationShell.Area, mainArea: Widget): Panel {
        const spacing = 0;
        let boxLayout: BoxLayout;
        switch (side) {
            case 'left':
                boxLayout = this.createBoxLayout([this.leftPanelHandler.sideBar, this.leftPanelHandler.stackedPanel], [0, 1],
                    { direction: 'left-to-right', spacing });
                break;
            case 'right':
                boxLayout = this.createBoxLayout([this.rightPanelHandler.stackedPanel, this.rightPanelHandler.sideBar], [1, 0],
                    { direction: 'left-to-right', spacing });
                break;
            case 'bottom':
                boxLayout = this.createBoxLayout([this.bottomPanelHandler.sideBar, this.bottomPanelHandler.stackedPanel], [0, 1],
                    { direction: 'top-to-bottom', spacing });
                break;
            default:
                throw new Error('Illegal argument: ' + side);
        }
        const boxPanel = new BoxPanel({ layout: boxLayout });
        boxPanel.id = 'theia-' + side + '-content-panel';

        let splitLayout: SplitLayout;
        switch (side) {
            case 'left':
                splitLayout = this.createSplitLayout([boxPanel, mainArea], [0, 1], { orientation: 'horizontal', spacing });
                break;
            case 'right':
                splitLayout = this.createSplitLayout([mainArea, boxPanel], [1, 0], { orientation: 'horizontal', spacing });
                break;
            case 'bottom':
                splitLayout = this.createSplitLayout([mainArea, boxPanel], [1, 0], { orientation: 'vertical', spacing });
                break;
            default:
                throw new Error('Illegal argument: ' + side);
        }
        const splitPanel = new SplitPanel({ layout: splitLayout });
        splitPanel.id = 'theia-' + side + '-split-panel';
        return splitPanel;
    }

    /**
     * Create a box layout to assemble the application shell layout.
     */
    protected createBoxLayout(widgets: Widget[], stretch?: number[], options?: BoxPanel.IOptions): BoxLayout {
        const boxLayout = new BoxLayout(options);
        for (let i = 0; i < widgets.length; i++) {
            if (stretch !== undefined && i < stretch.length) {
                BoxPanel.setStretch(widgets[i], stretch[i]);
            }
            boxLayout.addWidget(widgets[i]);
        }
        return boxLayout;
    }

    /**
     * Create a split layout to assemble the application shell layout.
     */
    protected createSplitLayout(widgets: Widget[], stretch?: number[], options?: Partial<SplitLayout.IOptions>): SplitLayout {
        let optParam: SplitLayout.IOptions = { renderer: SplitPanel.defaultRenderer, };
        if (options) {
            optParam = { ...optParam, ...options };
        }
        const splitLayout = new SplitLayout(optParam);
        for (let i = 0; i < widgets.length; i++) {
            if (stretch !== undefined && i < stretch.length) {
                SplitPanel.setStretch(widgets[i], stretch[i]);
            }
            splitLayout.addWidget(widgets[i]);
        }
        return splitLayout;
    }

    /**
     * Assemble the application shell layout. Override this method in order to change the arrangement
     * of the main area and the side bars.
     */
    protected createLayout(): Layout {
        const panelForRightSideBar = this.createSideBarLayout('right', this.mainPanel);
        const panelForBottomSideBar = this.createSideBarLayout('bottom', panelForRightSideBar);
        const panelForLeftSideBar = this.createSideBarLayout('left', panelForBottomSideBar);

        return this.createBoxLayout(
            [this.topPanel, panelForLeftSideBar, this.statusBar],
            [0, 1, 0],
            { direction: 'top-to-bottom', spacing: 0 }
        );
    }

    getLayoutData(): LayoutData {
        return {
            mainArea: {
                activeWidgets: this.tracker.activeWidget ? [this.tracker.activeWidget] : [],
                ...this.mainPanel.saveLayout()
            },
            leftBar: this.leftPanelHandler.getLayoutData(),
            rightBar: this.rightPanelHandler.getLayoutData(),
            bottomBar: this.bottomPanelHandler.getLayoutData(),
            statusBar: this.statusBar.getLayoutData()
        };
    }

    setLayoutData(layoutData?: LayoutData): void {
        if (layoutData) {
            if (layoutData.mainArea) {
                this.mainPanel.restoreLayout(layoutData.mainArea);
                this.registerWithFocusTracker(layoutData.mainArea.main);
                if (layoutData.mainArea.activeWidgets) {
                    for (const activeWidget of layoutData.mainArea.activeWidgets) {
                        this.activateMain(activeWidget.id);
                    }
                }
            }
            this.leftPanelHandler.setLayoutData(layoutData.leftBar);
            this.rightPanelHandler.setLayoutData(layoutData.rightBar);
            this.bottomPanelHandler.setLayoutData(layoutData.bottomBar);
            this.statusBar.setLayoutData(layoutData.statusBar);
        }
    }

    // tslint:disable-next-line:no-any
    protected registerWithFocusTracker(data: any): void {
        if (!data) {
            return;
        }
        if (data.hasOwnProperty("widgets")) {
            for (const widget of data["widgets"] as Widget[]) {
                this.track(widget);
            }
        } else if (data.hasOwnProperty("children")) {
            for (const child of data["children"] as object[]) {
                this.registerWithFocusTracker(child);
            }
        }
    }

    /**
     * The current widget in the shell's main area.
     */
    get currentWidget(): Widget | null {
        return this.tracker.currentWidget;
    }

    /**
     * The active widget in the shell's main area.
     */
    get activeWidget(): Widget | null {
        return this.tracker.activeWidget;
    }

    /**
     * True if left area is empty.
     */
    get leftAreaIsEmpty(): boolean {
        return this.leftPanelHandler.stackedPanel.widgets.length === 0;
    }

    /**
     * True if main area is empty.
     */
    get mainAreaIsEmpty(): boolean {
        return this.mainPanel.isEmpty;
    }

    /**
     * True if right area is empty.
     */
    get rightAreaIsEmpty(): boolean {
        return this.rightPanelHandler.stackedPanel.widgets.length === 0;
    }

    /**
     * True if top area is empty.
     */
    get topAreaIsEmpty(): boolean {
        return this.topPanel.widgets.length === 0;
    }

    /**
     * True if bottom area is empty.
     */
    get bottomAreaIsEmpty(): boolean {
        return this.bottomPanelHandler.stackedPanel.widgets.length === 0;
    }

    /**
     * Activate a widget in the left area.
     */
    activateLeft(id: string): void {
        this.leftPanelHandler.activate(id);
    }

    /**
     * Activate a widget in the main area.
     */
    activateMain(id: string): void {
        const dock = this.mainPanel;
        const widget = find(dock.widgets(), value => value.id === id);
        if (widget) {
            dock.activateWidget(widget);
        }
    }

    /*
     * Activate the next Tab in the active TabBar.
     */
    activateNextTab(): void {
        const current = this.currentTabBar();
        if (current) {
            const ci = current.currentIndex;
            if (ci !== -1) {
                if (ci < current.titles.length - 1) {
                    current.currentIndex += 1;
                    if (current.currentTitle) {
                        current.currentTitle.owner.activate();
                    }
                } else if (ci === current.titles.length - 1) {
                    const nextBar = this.nextTabBar();
                    if (nextBar) {
                        nextBar.currentIndex = 0;
                        if (nextBar.currentTitle) {
                            nextBar.currentTitle.owner.activate();
                        }
                    }
                }
            }
        }
    }

    /*
     * Activate the previous Tab in the active TabBar.
     */
    activatePreviousTab(): void {
        const current = this.currentTabBar();
        if (current) {
            const ci = current.currentIndex;
            if (ci !== -1) {
                if (ci > 0) {
                    current.currentIndex -= 1;
                    if (current.currentTitle) {
                        current.currentTitle.owner.activate();
                    }
                } else if (ci === 0) {
                    const prevBar = this.previousTabBar();
                    if (prevBar) {
                        const len = prevBar.titles.length;
                        prevBar.currentIndex = len - 1;
                        if (prevBar.currentTitle) {
                            prevBar.currentTitle.owner.activate();
                        }
                    }
                }
            }
        }
    }

    /**
     * Activate a widget in the right area.
     */
    activateRight(id: string): void {
        this.rightPanelHandler.activate(id);
    }

    /**
     * Activate a widget in the bottom area.
     */
    activateBottom(id: string): void {
        this.bottomPanelHandler.activate(id);
    }

    /**
     * Add a widget to the left content area.
     *
     * #### Notes
     * Widgets must have a unique `id` property, which will be used as the DOM id.
     */
    addToLeftArea(widget: Widget, options: ApplicationShell.ISideAreaOptions = {}): void {
        if (!widget.id) {
            console.error('widgets added to app shell must have unique id property');
            return;
        }
        const rank = options.rank !== undefined ? options.rank : 100;
        this.leftPanelHandler.addWidget(widget, rank);
    }

    /**
     * Add a widget to the main content area.
     *
     * #### Notes
     * Widgets must have a unique `id` property, which will be used as the DOM id.
     * All widgets added to the main area should be disposed after removal (or
     * simply disposed in order to remove).
     */
    addToMainArea(widget: Widget): void {
        if (!widget.id) {
            console.error('widgets added to app shell must have unique id property');
            return;
        }
        this.mainPanel.addWidget(widget, { mode: 'tab-after' });
        this.track(widget);
    }

    /**
     * Add a widget to the right content area.
     *
     * #### Notes
     * Widgets must have a unique `id` property, which will be used as the DOM id.
     */
    addToRightArea(widget: Widget, options: ApplicationShell.ISideAreaOptions = {}): void {
        if (!widget.id) {
            console.error('widgets added to app shell must have unique id property');
            return;
        }
        const rank = options.rank !== undefined ? options.rank : 100;
        this.rightPanelHandler.addWidget(widget, rank);
    }

    /**
     * Add a widget to the top content area.
     *
     * #### Notes
     * Widgets must have a unique `id` property, which will be used as the DOM id.
     */
    addToTopArea(widget: Widget, options: ApplicationShell.ISideAreaOptions = {}): void {
        if (!widget.id) {
            console.error('widgets added to app shell must have unique id property');
            return;
        }
        // Temporary: widgets are added to the panel in order of insertion.
        this.topPanel.addWidget(widget);
    }

    /**
     * Add a widget to the bottom content area.
     *
     * #### Notes
     * Widgets must have a unique `id` property, which will be used as the DOM id.
     */
    addToBottomArea(widget: Widget, options: ApplicationShell.ISideAreaOptions = {}): void {
        if (!widget.id) {
            console.error('widgets added to app shell must have unique id property');
            return;
        }
        const rank = options.rank !== undefined ? options.rank : 100;
        this.bottomPanelHandler.addWidget(widget, rank);
    }

    /**
     * Collapse the left area.
     */
    collapseLeft(): void {
        this.leftPanelHandler.collapse();
    }

    /**
     * Collapse the right area.
     */
    collapseRight(): void {
        this.rightPanelHandler.collapse();
    }

    /**
     * Collapse the right area.
     */
    collapseBottom(): void {
        this.bottomPanelHandler.collapse();
    }

    /**
     * Close the current tab.
     */
    closeTab(): void {
        const current = this.currentTabBar();
        if (current) {
            const ci = current.currentIndex;
            if (ci !== -1) {
                const title = current.currentTitle;
                if (title !== null) {
                    title.owner.close();
                }
            }
        }
    }

    /**
     * Close the tabs right of the current one.
     */
    closeRightTabs(): void {
        const current = this.currentTabBar();
        if (current) {
            const length = current.titles.length;
            if (length > 0) {
                const ci = current.currentIndex;
                const last = length - 1;
                const next = ci + 1;
                if (ci !== -1 && last > ci) {
                    for (let i = next; i <= last; i++) {
                        current.titles[next].owner.close();
                    }
                }
            }
        }
    }

    /**
     * Close all tabs expect the current one.
     */
    closeOtherTabs(): void {
        const current = this.currentTabBar();
        if (current) {
            const ci = current.currentIndex;
            if (ci !== -1) {
                const titles = current.titles.slice(0);
                for (let i = 0; i < titles.length; i++) {
                    if (i !== ci) {
                        titles[i].owner.close();
                    }
                }
            }

        }
    }

    /**
     * Close all tabs.
     */
    closeAllTabs(): void {
        const current = this.currentTabBar();
        if (current) {
            const length = current.titles.length;
            for (let i = 0; i < length; i++) {
                current.titles[0].owner.close();
            }
        }
    }

    /**
     * Test whether the current widget is dirty.
     */
    canSave(): boolean {
        return Saveable.isDirty(this.currentWidget);
    }

    /**
     * Save the current widget if it is dirty.
     */
    async save(): Promise<void> {
        await Saveable.save(this.currentWidget);
    }

    /**
     * Test whether there is a dirty widget.
     */
    canSaveAll(): boolean {
        return this.tracker.widgets.some(Saveable.isDirty);
    }

    /**
     * Save all dirty widgets.
     */
    async saveAll(): Promise<void> {
        await Promise.all(this.tracker.widgets.map(Saveable.save));
    }

    /**
     * Close all widgets in the main area.
     */
    closeAll(): void {
        each(toArray(this.mainPanel.widgets()), widget => {
            widget.close();
        });
    }

    /**
     * Checks to see if a tab is currently selected
     */
    hasSelectedTab(): boolean {
        const current = this.currentTabBar();
        if (current) {
            return current.currentIndex !== -1;
        } else {
            return false;
        }
    }

    /*
     * Return the TabBar that has the currently active Widget or undefined.
     */
    private currentTabBar(): TabBar<Widget> | undefined {
        const current = this.tracker.currentWidget;
        if (current) {
            const title = current.title;
            const tabBar = find(this.mainPanel.tabBars(), bar => {
                return ArrayExt.firstIndexOf(bar.titles, title) > -1;
            });
            return tabBar;
        }
        return undefined;
    }

    /*
     * Return the TabBar previous to the current TabBar (see above) or undefined.
     */
    private previousTabBar(): TabBar<Widget> | null {
        const current = this.currentTabBar();
        if (current) {
            const bars = toArray(this.mainPanel.tabBars());
            const len = bars.length;
            const ci = ArrayExt.firstIndexOf(bars, current);
            let prevBar: TabBar<Widget> | null = null;
            if (ci > 0) {
                prevBar = bars[ci - 1];
            } else if (ci === 0) {
                prevBar = bars[len - 1];
            }
            return prevBar;
        }
        return null;
    }

    /*
     * Return the TabBar next to the current TabBar (see above) or undefined.
     */
    private nextTabBar(): TabBar<Widget> | null {
        const current = this.currentTabBar();
        if (current) {
            const bars = toArray(this.mainPanel.tabBars());
            const len = bars.length;
            const ci = ArrayExt.firstIndexOf(bars, current);
            let nextBar: TabBar<Widget> | null = null;
            if (ci < (len - 1)) {
                nextBar = bars[ci + 1];
            } else if (ci === len - 1) {
                nextBar = bars[0];
            }
            return nextBar;
        }
        return null;
    }

    /**
     * Handle a change to the dock area current widget.
     */
    private onCurrentChanged(sender: any, args: FocusTracker.IChangedArgs<Widget>): void {
        if (args.newValue) {
            args.newValue.title.className += ` ${CURRENT_CLASS}`;
        }
        if (args.oldValue) {
            args.oldValue.title.className = (
                args.oldValue.title.className.replace(CURRENT_CLASS, '')
            );
        }
        this.currentChanged.emit(args);
    }

    /**
     * Handle a change to the dock area active widget.
     */
    private onActiveChanged(sender: any, args: FocusTracker.IChangedArgs<Widget>): void {
        if (args.newValue) {
            args.newValue.title.className += ` ${ACTIVE_CLASS}`;
        }
        if (args.oldValue) {
            args.oldValue.title.className = (
                args.oldValue.title.className.replace(ACTIVE_CLASS, '')
            );
        }
        this.activeChanged.emit(args);
    }

    protected track(widget: Widget): void {
        this.tracker.add(widget);
        Saveable.apply(widget);
    }
}

/**
 * The namespace for `ApplicationShell` class statics.
 */
export namespace ApplicationShell {
    /**
     * The areas of the application shell where widgets can reside.
     */
    export type Area = 'main' | 'top' | 'left' | 'right' | 'bottom';

    /**
     * The options for adding a widget to a side area of the shell.
     */
    export interface ISideAreaOptions {
        /**
         * The rank order of the widget among its siblings.
         */
        rank?: number;
    }

    /**
     * An arguments object for the changed signals.
     */
    export type IChangedArgs = FocusTracker.IChangedArgs<Widget>;
}

/**
 * An object which holds a widget and its sort rank.
 */
interface IRankItem {
    /**
     * The widget for the item.
     */
    widget: Widget;

    /**
     * The sort rank of the widget.
     */
    rank: number;
}

/**
 * A less-than comparison function for side bar rank items.
 */
function itemCmp(first: IRankItem, second: IRankItem): number {
    return first.rank - second.rank;
}

/**
 * A class which manages a side bar and related stacked panel.
 */
export class SideBarHandler {

    private readonly items = new Array<IRankItem>();

    readonly sideBar: TabBar<Widget>;
    readonly stackedPanel: StackedPanel;

    /**
     * Construct a new side bar handler.
     */
    constructor(private readonly side: ApplicationShell.Area) {
        this.sideBar = new TabBar<Widget>({
            orientation: side === 'left' || side === 'right' ? 'vertical' : 'horizontal',
            insertBehavior: 'none',
            removeBehavior: 'none',
            allowDeselect: true
        });
        this.stackedPanel = new StackedPanel();
        this.sideBar.hide();
        this.stackedPanel.hide();
        this.sideBar.currentChanged.connect(this.onCurrentChanged, this);
        this.sideBar.tabActivateRequested.connect(this.onTabActivateRequested, this);
        this.stackedPanel.widgetRemoved.connect(this.onWidgetRemoved, this);
    }

    getLayoutData(): SideBarData {
        const currentActive = this.findWidgetByTitle(this.sideBar.currentTitle) || undefined;
        return {
            activeWidgets: currentActive ? [currentActive] : [],
            widgets: this.stackedPanel.widgets as Widget[]
        };
    }

    setLayoutData(layoutData: SideBarData | undefined) {
        if (layoutData) {
            this.collapse();
            if (layoutData.widgets) {
                let index = 0;
                for (const widget of layoutData.widgets) {
                    if (widget) {
                        this.addWidget(widget, index++);
                    }
                }
            }
            if (layoutData.activeWidgets) {
                for (const widget of layoutData.activeWidgets) {
                    this.activate(widget.id);
                }
            }
        }
    }

    /**
     * Activate a widget residing in the side bar by ID.
     *
     * @param id - The widget's unique ID.
     */
    activate(id: string): void {
        const widget = this.findWidgetByID(id);
        if (widget) {
            this.sideBar.currentTitle = widget.title;
            widget.activate();
            this.refreshVisibility();
        }
    }

    /**
     * Collapse the sidebar so no items are expanded.
     */
    collapse(): void {
        this.sideBar.currentTitle = null;
        this.refreshVisibility();
    }

    /**
     * Add a widget and its title to the stacked panel and side bar.
     *
     * If the widget is already added, it will be moved.
     */
    addWidget(widget: Widget, rank: number): void {
        widget.parent = null;
        widget.hide();
        const item = { widget, rank };
        const index = this.findInsertIndex(item);
        ArrayExt.insert(this.items, index, item);
        this.stackedPanel.insertWidget(index, widget);
        this.sideBar.insertTab(index, widget.title);
        this.refreshVisibility();
    }

    /**
     * Find the insertion index for a rank item.
     */
    private findInsertIndex(item: IRankItem): number {
        return ArrayExt.upperBound(this.items, item, itemCmp);
    }

    /**
     * Find the index of the item with the given widget, or `-1`.
     */
    private findWidgetIndex(widget: Widget): number {
        return ArrayExt.findFirstIndex(this.items, item => item.widget === widget);
    }

    /**
     * Find the widget which owns the given title, or `null`.
     */
    private findWidgetByTitle(title: Title<Widget> | null): Widget | null {
        const item = find(this.items, value => value.widget.title === title);
        return item ? item.widget : null;
    }

    /**
     * Find the widget with the given id, or `null`.
     */
    private findWidgetByID(id: string): Widget | null {
        const item = find(this.items, value => value.widget.id === id);
        return item ? item.widget : null;
    }

    /**
     * Refresh the visibility of the side bar and stacked panel.
     */
    private refreshVisibility(): void {
        this.sideBar.setHidden(this.sideBar.titles.length === 0);
        const hideStack = this.sideBar.currentTitle === null;
        this.stackedPanel.setHidden(hideStack);
        if (this.stackedPanel.parent) {
            if (hideStack) {
                this.stackedPanel.parent.addClass('theia-mod-collapsed');
            } else {
                this.stackedPanel.parent.removeClass('theia-mod-collapsed');
            }
        }
    }

    /**
     * Handle the `currentChanged` signal from the sidebar.
     */
    private onCurrentChanged(sender: TabBar<Widget>, args: TabBar.ICurrentChangedArgs<Widget>): void {
        const oldWidget = this.findWidgetByTitle(args.previousTitle);
        const newWidget = this.findWidgetByTitle(args.currentTitle);
        if (oldWidget) {
            oldWidget.hide();
        }
        if (newWidget) {
            newWidget.show();
        }
        if (newWidget) {
            document.body.setAttribute(`data-${this.side}Area`, newWidget.id);
        } else {
            document.body.removeAttribute(`data-${this.side}Area`);
        }
        this.refreshVisibility();
    }

    /**
     * Handle a `tabActivateRequest` signal from the sidebar.
     */
    private onTabActivateRequested(sender: TabBar<Widget>, args: TabBar.ITabActivateRequestedArgs<Widget>): void {
        args.title.owner.activate();
    }

    /*
     * Handle the `widgetRemoved` signal from the stacked panel.
     */
    private onWidgetRemoved(sender: StackedPanel, widget: Widget): void {
        ArrayExt.removeAt(this.items, this.findWidgetIndex(widget));
        this.sideBar.removeTab(widget.title);
        this.refreshVisibility();
    }
}
