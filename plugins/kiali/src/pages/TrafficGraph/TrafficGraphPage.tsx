import React, { useRef, useState } from 'react';
import { useAsyncFn, useDebounce } from 'react-use';

import { Entity } from '@backstage/catalog-model';
import { Content } from '@backstage/core-components';
import { useApi } from '@backstage/core-plugin-api';

import { CircularProgress, useTheme } from '@material-ui/core';
import {
  action,
  createTopologyControlButtons,
  defaultControlButtonsOptions,
  Model,
  TopologyControlBar,
  TopologyView,
  Visualization,
  VisualizationProvider,
  VisualizationSurface,
} from '@patternfly/react-topology';

import { DefaultSecondaryMasthead } from '../../components/DefaultSecondaryMasthead/DefaultSecondaryMasthead';
import * as FilterHelper from '../../components/FilterList/FilterHelper';
import { TimeDurationComponent } from '../../components/Time/TimeDurationComponent';
import { getEntityNs, nsEqual } from '../../helpers/namespaces';
import { getErrorString, kialiApiRef } from '../../services/Api';
import { KialiAppState, KialiContext } from '../../store';
import { kialiStyle } from '../../styles/StyleUtils';
import { EdgeLabelMode, GraphType, TrafficRate } from '../../types/Graph';
import { ENTITY } from '../../types/types';
import { KialiComponentFactory } from './factories/KialiComponentFactory';
import { KialiLayoutFactory } from './factories/KialiLayoutFactory';
import { decorateGraphData } from './util/GraphDecorator';
import { generateDataModel } from './util/GraphGenerator';

const graphStyle = kialiStyle({
  height: '93%',
});

const graphConfig = {
  id: 'g1',
  type: 'graph',
  layout: 'Dagre',
};

const getVisualization = (): Visualization => {
  const vis = new Visualization();

  vis.registerLayoutFactory(KialiLayoutFactory);
  vis.registerComponentFactory(KialiComponentFactory);
  vis.setFitToScreenOnLayout(true);

  return vis;
};

const getNamespaces = (
  entity: Entity | undefined,
  kialiState: KialiAppState,
) => {
  if (entity && !kialiState.namespaces) {
    return getEntityNs(entity);
  }
  return kialiState.namespaces.activeNamespaces.map(ns => ns.name);
};

function TrafficGraphPage(props: { view?: string; entity?: Entity }) {
  const kialiState = React.useContext(KialiContext) as KialiAppState;
  const kialiClient = useApi(kialiApiRef);
  const theme = useTheme();

  const htmlElement = document.getElementsByTagName('html')[0];
  if (htmlElement) {
    if (theme.palette.type === 'dark') {
      htmlElement.classList.add('pf-v5-theme-dark');
    } else {
      htmlElement.classList.remove('pf-v5-theme-dark');
    }
  }

  const [duration, setDuration] = useState(FilterHelper.currentDuration());

  const activeNamespaces = getNamespaces(props.entity, kialiState);
  const prevActiveNs = useRef(activeNamespaces);
  const prevDuration = useRef(duration);

  const [model, setModel] = useState<Model>({
    nodes: [],
    edges: [],
    graph: graphConfig,
  });

  const [controller] = useState(getVisualization());

  const fetchGraph = async () => {
    if (activeNamespaces.length === 0) {
      setModel({
        nodes: [],
        edges: [],
        graph: graphConfig,
      });
      return;
    }

    const graphQueryElements = {
      appenders: 'health,deadNode,istio,serviceEntry,meshCheck,workloadEntry',
      activeNamespaces: activeNamespaces.join(','),
      namespaces: activeNamespaces.join(','),
      graphType: GraphType.VERSIONED_APP,
      injectServiceNodes: true,
      boxByNamespace: true,
      boxByCluster: true,
      showOutOfMesh: false,
      showSecurity: false,
      showVirtualServices: false,
      edgeLabels: [
        EdgeLabelMode.TRAFFIC_RATE,
        EdgeLabelMode.TRAFFIC_DISTRIBUTION,
      ],
      trafficRates: [
        TrafficRate.HTTP_REQUEST,
        TrafficRate.GRPC_TOTAL,
        TrafficRate.TCP_TOTAL,
      ],
    };

    try {
      const data = await kialiClient.getGraphElements(graphQueryElements);
      const graphData = decorateGraphData(data.elements, data.duration);
      const g = generateDataModel(graphData, graphQueryElements);
      setModel({
        nodes: g.nodes,
        edges: g.edges,
        graph: graphConfig,
      });
    } catch (error: any) {
      kialiState.alertUtils?.add(
        `Could not fetch services: ${getErrorString(error)}`,
      );
    }
  };

  const timeDuration = (
    <TimeDurationComponent
      key="DurationDropdown"
      id="graph-duration-dropdown"
      disabled={false}
      duration={duration.toString()}
      setDuration={setDuration}
      label="From:"
    />
  );

  React.useEffect(() => {
    if (
      duration !== prevDuration.current ||
      !nsEqual(activeNamespaces, prevActiveNs.current)
    ) {
      fetchGraph();
      prevDuration.current = duration;
      prevActiveNs.current = activeNamespaces;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeNamespaces, duration]);

  React.useEffect(() => {
    controller.fromModel(model, false);
  }, [model, controller]);

  const [state, refresh] = useAsyncFn(
    async () => {
      await fetchGraph();
    },
    [],
    { loading: true },
  );

  useDebounce(refresh, 10);

  if (state.loading) {
    return <CircularProgress />;
  }

  return (
    <Content className={graphStyle} data-test="kiali-graph-card">
      {props.view !== ENTITY && (
        <DefaultSecondaryMasthead
          elements={[timeDuration]}
          onRefresh={refresh}
        />
      )}
      <TopologyView
        controlBar={
          <TopologyControlBar
            controlButtons={createTopologyControlButtons({
              ...defaultControlButtonsOptions,
              zoomInCallback: action(() => {
                controller.getGraph().scaleBy(4 / 3);
              }),
              zoomOutCallback: action(() => {
                controller.getGraph().scaleBy(0.75);
              }),
              fitToScreenCallback: action(() => {
                controller.getGraph().fit(80);
              }),
              resetViewCallback: action(() => {
                controller.getGraph().reset();
                controller.getGraph().layout();
              }),
              legend: false,
              zoomInAriaLabel: '',
              zoomOutAriaLabel: '',
              fitToScreenAriaLabel: '',
              resetViewAriaLabel: '',
              zoomInTip: '',
              zoomOutTip: '',
              fitToScreenTip: '',
              resetViewTip: '',
            })}
          />
        }
      >
        <VisualizationProvider controller={controller}>
          <VisualizationSurface state={model} />
        </VisualizationProvider>
      </TopologyView>
    </Content>
  );
}

export default TrafficGraphPage;
